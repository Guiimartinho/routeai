// ─── .routeai File Format ────────────────────────────────────────────────────
// JSON-based project file format with version control and validation.
// Future: migrate to SQLite-based format for large projects (desktop app).

import type { SchematicState, BoardState, SchNet } from '../types';
import type { DesignRulesConfig } from './designRules';
import { createDefaultDesignRules } from './designRules';
import type { ProjectData, ProjectMeta } from './storage';

// ─── File Format Types ───────────────────────────────────────────────────────

export type RouteAIFileFormat = 'routeai-json' | 'routeai-sqlite';

export interface RouteAIFile {
  version: string;              // Semver, e.g. "1.0.0"
  format: RouteAIFileFormat;    // "routeai-json" for now
  metadata: ProjectMeta;
  schematic: SchematicState;
  board: BoardState;
  nets: SchNet[];
  designRules: DesignRulesConfig;
  customSymbols?: any[];
  customFootprints?: any[];
}

// Current file format version
const CURRENT_VERSION = '1.0.0';
const CURRENT_FORMAT: RouteAIFileFormat = 'routeai-json';

// ─── Serialization ───────────────────────────────────────────────────────────

/**
 * Serialize the current project state into a RouteAIFile structure
 * suitable for saving to disk.
 */
export function serializeProject(
  data: ProjectData,
  opts?: {
    customSymbols?: any[];
    customFootprints?: any[];
  },
): RouteAIFile {
  const meta: ProjectMeta = {
    id: slugify(data.metadata.name),
    name: data.metadata.name,
    modifiedAt: data.metadata.modifiedAt || new Date().toISOString(),
    createdAt: data.metadata.createdAt || new Date().toISOString(),
    componentCount: data.schematic.components.length,
    netCount: data.nets.length,
  };

  return {
    version: CURRENT_VERSION,
    format: CURRENT_FORMAT,
    metadata: meta,
    schematic: data.schematic,
    board: data.board,
    nets: data.nets,
    designRules: data.designRules,
    customSymbols: opts?.customSymbols,
    customFootprints: opts?.customFootprints,
  };
}

/**
 * Deserialize a RouteAIFile back into the internal ProjectData shape
 * used by the project store.
 */
export function deserializeProject(file: RouteAIFile): ProjectData {
  // Handle version migrations here in the future
  // if (semverLt(file.version, '2.0.0')) { migrate... }

  return {
    metadata: {
      name: file.metadata.name,
      version: file.version,
      createdAt: file.metadata.createdAt,
      modifiedAt: file.metadata.modifiedAt,
      author: '',
      description: '',
    },
    schematic: file.schematic,
    board: file.board,
    nets: file.nets || [],
    designRules: file.designRules || createDefaultDesignRules(),
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Type guard that validates an unknown object conforms to the RouteAIFile schema.
 * Returns true if the data is a valid RouteAIFile, false otherwise.
 */
export function validateProjectFile(data: unknown): data is RouteAIFile {
  if (typeof data !== 'object' || data === null) return false;

  const obj = data as Record<string, unknown>;

  // Required top-level fields
  if (typeof obj.version !== 'string') return false;
  if (typeof obj.format !== 'string') return false;
  if (!['routeai-json', 'routeai-sqlite'].includes(obj.format as string)) return false;

  // Metadata
  if (typeof obj.metadata !== 'object' || obj.metadata === null) return false;
  const meta = obj.metadata as Record<string, unknown>;
  if (typeof meta.name !== 'string') return false;

  // Schematic
  if (typeof obj.schematic !== 'object' || obj.schematic === null) return false;
  const sch = obj.schematic as Record<string, unknown>;
  if (!Array.isArray(sch.components)) return false;
  if (!Array.isArray(sch.wires)) return false;
  if (!Array.isArray(sch.labels)) return false;

  // Board
  if (typeof obj.board !== 'object' || obj.board === null) return false;
  const brd = obj.board as Record<string, unknown>;
  if (!Array.isArray(brd.components)) return false;
  if (!Array.isArray(brd.traces)) return false;
  if (!Array.isArray(brd.vias)) return false;
  if (!Array.isArray(brd.zones)) return false;
  if (typeof brd.outline !== 'object' || brd.outline === null) return false;
  if (!Array.isArray(brd.layers)) return false;

  // Nets
  if (!Array.isArray(obj.nets)) return false;

  // Design rules (optional for backward compat — we have defaults)
  if (obj.designRules !== undefined) {
    if (typeof obj.designRules !== 'object' || obj.designRules === null) return false;
  }

  return true;
}

// ─── File I/O Helpers ────────────────────────────────────────────────────────

/**
 * Export a project as a downloadable .routeai file.
 */
export function downloadRouteAIFile(data: ProjectData, filename?: string): void {
  const file = serializeProject(data);
  const json = JSON.stringify(file, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const safeName = filename || data.metadata.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeName}.routeai`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read and parse a .routeai file from a File handle.
 * Throws if the file is invalid.
 */
export async function readRouteAIFile(file: File): Promise<RouteAIFile> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }

  // Accept both RouteAIFile format and legacy ProjectData format
  if (validateProjectFile(parsed)) {
    return parsed;
  }

  // Try legacy format: { metadata, schematic, board, nets, designRules }
  const legacy = parsed as Record<string, unknown>;
  if (
    typeof legacy.metadata === 'object' &&
    legacy.metadata !== null &&
    typeof legacy.schematic === 'object' &&
    typeof legacy.board === 'object'
  ) {
    // Wrap legacy format into RouteAIFile
    const legacyMeta = legacy.metadata as Record<string, unknown>;
    const legacyData: ProjectData = {
      metadata: {
        name: (legacyMeta.name as string) || 'Imported Project',
        version: (legacyMeta.version as string) || '1.0.0',
        createdAt: (legacyMeta.createdAt as string) || new Date().toISOString(),
        modifiedAt: (legacyMeta.modifiedAt as string) || new Date().toISOString(),
        author: (legacyMeta.author as string) || '',
        description: (legacyMeta.description as string) || '',
      },
      schematic: legacy.schematic as SchematicState,
      board: legacy.board as BoardState,
      nets: (legacy.nets as SchNet[]) || [],
      designRules: (legacy.designRules as DesignRulesConfig) || createDefaultDesignRules(),
    };
    return serializeProject(legacyData);
  }

  throw new Error(
    'Invalid file format. Expected a .routeai file or legacy RouteAI JSON project.',
  );
}

// ─── SQLite Format Stub ──────────────────────────────────────────────────────
// Placeholder for future desktop SQLite-based format.
// The desktop app (Electron/Tauri) will use sql.js or native SQLite to
// store projects in a single .routeai file with multiple tables:
//   - project_meta (single row)
//   - components, wires, labels, nets (schematic)
//   - brd_components, traces, vias, zones (board)
//   - design_rules, custom_symbols, custom_footprints
// Benefits:
//   - Incremental save (no full JSON serialization)
//   - Query individual objects without loading entire project
//   - Efficient for large designs (10k+ components)
//   - Built-in integrity checking

export interface SQLiteFormatOptions {
  /** Enable WAL mode for concurrent reads (desktop only) */
  walMode?: boolean;
  /** Compress blob data (component graphics, footprint outlines) */
  compressBlobs?: boolean;
}

/**
 * Check if the current environment supports SQLite-based storage.
 * Returns true in Electron/Tauri desktop environments.
 */
export function isSQLiteAvailable(): boolean {
  // Check for Electron
  if (typeof window !== 'undefined' && (window as any).__TAURI__) return true;
  if (typeof process !== 'undefined' && (process as any).versions?.electron) return true;
  return false;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}
