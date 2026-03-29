// ─── Cross-Probe Engine ─────────────────────────────────────────────────────
// Bidirectional navigation between Schematic and Board editors.
// Allows finding the corresponding element on the other side by component ref,
// and collecting all elements on a given net for highlight.

import type {
  SchComponent, BrdComponent, SchematicState, BoardState, SchNet,
} from '../types';

/**
 * Find a board component by its schematic reference designator (e.g. "R1").
 */
export function findBoardComponent(
  schRef: string,
  board: BoardState,
): BrdComponent | null {
  return board.components.find(c => c.ref === schRef) ?? null;
}

/**
 * Find a schematic component by its board reference designator (e.g. "R1").
 */
export function findSchComponent(
  brdRef: string,
  schematic: SchematicState,
): SchComponent | null {
  return schematic.components.find(c => c.ref === brdRef) ?? null;
}

/**
 * Given a net name, return all schematic pin IDs and board pad IDs on that net.
 * Useful for highlighting entire nets across both views.
 */
export function getNetHighlight(
  netName: string,
  schematic: SchematicState,
  board: BoardState,
): { schPins: string[]; brdPads: string[] } {
  // Find the net by name
  const net = schematic.nets.find(
    n => n.name.toUpperCase() === netName.toUpperCase(),
  );

  const schPins: string[] = net ? [...net.pins] : [];

  // Collect board pads whose netId matches
  const brdPads: string[] = [];
  const netId = net?.id ?? '';
  if (netId) {
    for (const comp of board.components) {
      for (const pad of comp.pads) {
        if (pad.netId === netId) {
          brdPads.push(pad.id);
        }
      }
    }
  }

  return { schPins, brdPads };
}

/**
 * Custom event detail shape dispatched by editors for cross-probing.
 */
export interface CrossProbeDetail {
  source: 'sch' | 'board';
  ref: string;
}

/**
 * Dispatch a cross-probe event from either editor.
 * The App component listens for this and switches tabs + highlights.
 */
export function dispatchCrossProbe(detail: CrossProbeDetail): void {
  window.dispatchEvent(
    new CustomEvent<CrossProbeDetail>('routeai-crossprobe', { detail }),
  );
}
