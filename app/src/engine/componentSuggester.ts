// ─── Component Suggester ──────────────────────────────────────────────────
// Given a newly placed IC, check the datasheet knowledge base and suggest
// required supporting components (bypass caps, crystals, pull-ups, etc.).
// This is purely offline — no LLM calls, just pattern matching + lookup.

import { findICKnowledge, type ICKnowledge, type SupportComponent } from './datasheetKnowledge';
import { getRulesForComponent } from './componentRules';
import type { SchComponent } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────

export interface ComponentSuggestion {
  component: SupportComponent;
  forIC: string;           // reference of the IC this supports (e.g., "U1")
  forICValue: string;      // value of the IC (e.g., "STM32F103C8T6")
  autoPlace: boolean;      // can be auto-placed near the IC
}

export interface SchematicAuditResult {
  missing: ComponentSuggestion[];
  notes: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build a signature for a support component so we can check if an equivalent
 * already exists in the schematic. We match by symbol type + approximate value.
 */
function supportComponentSignature(sc: SupportComponent): string {
  return `${sc.symbol}::${normalizeValue(sc.value)}`;
}

/**
 * Normalize component values for matching.
 * "100nF" → "100nf", "10K" → "10k", "4.7uF" → "4.7uf"
 */
function normalizeValue(v: string): string {
  return v.toLowerCase().replace(/\s+/g, '');
}

/**
 * Check if a schematic component could be a support component for an IC.
 * Matches on symbol type and approximate value.
 */
function matchesSupport(existing: SchComponent, sc: SupportComponent): boolean {
  // Symbol type must match
  if (existing.symbol !== sc.symbol) return false;

  // Value must be close (normalized comparison)
  const existingVal = normalizeValue(existing.value);
  const targetVal = normalizeValue(sc.value);

  // Exact match
  if (existingVal === targetVal) return true;

  // Try matching just the numeric+unit part (e.g., "100nf" in "cap 100nf x7r")
  if (existingVal.includes(targetVal) || targetVal.includes(existingVal)) return true;

  return false;
}

/**
 * Check if a component is "near" an IC (within maxDistance_mm, using schematic units).
 * Schematic coordinates are in mm (grid = 2.54mm), so we compare directly.
 */
function isNearIC(component: SchComponent, ic: SchComponent, maxDistance: number): boolean {
  const dx = component.x - ic.x;
  const dy = component.y - ic.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // In schematic space, distances are in mm. Symbols are ~40 units wide.
  // We use a generous threshold: maxDistance * 10 (schematic units are larger than board mm)
  return dist < maxDistance * 10;
}

/**
 * Count how many existing components match a given support component requirement,
 * optionally filtering to those near the IC.
 */
function countMatchingComponents(
  existing: SchComponent[],
  sc: SupportComponent,
  ic: SchComponent,
): number {
  let count = 0;
  for (const comp of existing) {
    if (matchesSupport(comp, sc)) {
      // If a max distance is specified, only count nearby ones
      if (sc.maxDistance_mm) {
        if (isNearIC(comp, ic, sc.maxDistance_mm)) {
          count++;
        }
      } else {
        count++;
      }
    }
  }
  return count;
}

// ─── Main functions ───────────────────────────────────────────────────────

/**
 * Given a newly placed component, check if it matches any IC in the knowledge base
 * and return suggested supporting components.
 *
 * Only returns components that are NOT already present in the schematic.
 */
export function suggestSupportComponents(
  component: SchComponent,
  existingComponents: SchComponent[],
): ComponentSuggestion[] {
  // 3-level lookup: datasheet-specific → generic by type → none
  const { rules, source } = getRulesForComponent(
    component.value, component.symbol || component.type, component.ref, component.footprint || ''
  );
  if (!rules) return [];

  // Use the rules (either from datasheet knowledge or generic type rules)
  const knowledge = { supportComponents: rules.supportComponents, designNotes: rules.designNotes };

  const suggestions: ComponentSuggestion[] = [];

  for (const sc of knowledge.supportComponents) {
    // Determine how many of this support component are needed
    let needed = sc.quantity;

    // If perPin is set, multiply by how many of those pins exist
    // (for simplicity, we use the quantity as-is since the knowledge base
    // already accounts for typical pin counts)
    if (sc.perPin) {
      // The quantity field already represents "per pin" count,
      // so we keep it as-is (typical package)
      needed = sc.quantity;
    }

    // Count how many matching components already exist nearby
    const alreadyPlaced = countMatchingComponents(existingComponents, sc, component);
    const missing = needed - alreadyPlaced;

    if (missing > 0) {
      for (let i = 0; i < missing; i++) {
        suggestions.push({
          component: sc,
          forIC: component.ref,
          forICValue: component.value,
          autoPlace: sc.placement === 'close_to_ic' || sc.placement === undefined,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Check all components in the schematic and return ALL missing support components
 * plus design notes for each recognized IC.
 */
export function auditSchematic(
  components: SchComponent[],
): SchematicAuditResult {
  const allMissing: ComponentSuggestion[] = [];
  const allNotes: string[] = [];
  const processedICs = new Set<string>();

  for (const comp of components) {
    const { rules } = getRulesForComponent(
      comp.value, comp.symbol || comp.type, comp.ref, comp.footprint || ''
    );
    if (!rules) continue;
    const knowledge = { supportComponents: rules.supportComponents, designNotes: rules.designNotes };

    // Avoid duplicating suggestions for the same IC value placed multiple times
    // (each instance still gets its own support components)
    const icKey = `${comp.id}::${comp.value}`;
    if (processedICs.has(icKey)) continue;
    processedICs.add(icKey);

    // Get missing support components for this IC
    const suggestions = suggestSupportComponents(comp, components);
    allMissing.push(...suggestions);

    // Add design notes (only once per component reference)
    if (!allNotes.some(n => n.startsWith(`[${comp.ref}]`))) {
      for (const note of (knowledge.designNotes || [])) {
        allNotes.push(`[${comp.ref} ${comp.value}] ${note}`);
      }
    }
  }

  return { missing: allMissing, notes: allNotes };
}

/**
 * Calculate auto-placement positions for support components around an IC.
 * Places components in a ring pattern around the IC center.
 */
export function calculateAutoPlacement(
  ic: SchComponent,
  count: number,
  startRadius: number = 40,
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const GRID = 2.54;

  // Place components in a grid pattern around the IC
  // Start from top-right, go clockwise
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacingX = 30; // schematic units spacing
  const spacingY = 20;

  // Offset from IC center
  const startX = ic.x + startRadius;
  const startY = ic.y - ((rows - 1) * spacingY) / 2;

  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = Math.round((startX + col * spacingX) / GRID) * GRID;
    const y = Math.round((startY + row * spacingY) / GRID) * GRID;
    positions.push({ x, y });
  }

  return positions;
}

/**
 * Get a human-readable summary of suggestions for display in a toast/popup.
 */
export function summarizeSuggestions(suggestions: ComponentSuggestion[]): string {
  if (suggestions.length === 0) return '';

  // Group by role for a compact summary
  const groups = new Map<string, { value: string; count: number }>();
  for (const s of suggestions) {
    const key = `${s.component.role}::${s.component.value}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
    } else {
      groups.set(key, { value: s.component.value, count: 1 });
    }
  }

  const parts: string[] = [];
  for (const [key, { value, count }] of groups) {
    const role = key.split('::')[0].replace(/_/g, ' ');
    parts.push(`${count}x ${value} ${role}`);
  }

  return parts.join(', ');
}
