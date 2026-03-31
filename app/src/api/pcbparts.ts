// ─── pcbparts.ts ─ PCBParts MCP integration (optional online component data) ─
//
// Wraps the /api/pcbparts/* proxy endpoints.  All functions return
// { ..., offline: boolean } so callers can gracefully degrade when the
// PCBParts server or the ML service is unreachable.

const BASE = '/api/pcbparts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PCBPartResult {
  lcsc: string;
  mpn: string;
  manufacturer: string;
  description: string;
  package: string;
  price: number | null;
  stock: number | null;
  category: string;
  datasheet: string;
  hasSymbol: boolean;
  hasFootprint: boolean;
}

export interface PCBPartsStock {
  lcsc: string;
  stock: number;
  pricing: Array<{ qty: number; price: number }>;
}

export interface PCBPartsSensor {
  name: string;
  mpn: string;
  measurement: string;
  protocol: string;
  description: string;
  lcsc?: string;
}

// ─── Component Search ───────────────────────────────────────────────────────

export async function searchPCBParts(
  query: string,
  options?: { subcategory?: string; limit?: number },
): Promise<{ parts: PCBPartResult[]; offline: boolean }> {
  const params = new URLSearchParams({ q: query });
  if (options?.subcategory) params.set('subcategory', options.subcategory);
  if (options?.limit) params.set('limit', String(options.limit));
  try {
    const resp = await fetch(`${BASE}/search?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { parts: [], offline: true };
    return await resp.json();
  } catch {
    return { parts: [], offline: true };
  }
}

// ─── Alternatives ───────────────────────────────────────────────────────────

export async function getAlternatives(
  lcsc: string,
): Promise<{ alternatives: PCBPartResult[]; offline: boolean }> {
  try {
    const resp = await fetch(`${BASE}/alternatives/${lcsc}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { alternatives: [], offline: true };
    return await resp.json();
  } catch {
    return { alternatives: [], offline: true };
  }
}

// ─── Stock ──────────────────────────────────────────────────────────────────

export async function getStock(
  lcsc: string,
): Promise<{ stock: PCBPartsStock | null; offline: boolean }> {
  try {
    const resp = await fetch(`${BASE}/stock/${lcsc}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { stock: null, offline: true };
    return await resp.json();
  } catch {
    return { stock: null, offline: true };
  }
}

// ─── Sensor Recommendation ──────────────────────────────────────────────────

export async function recommendSensors(
  measurement: string,
  protocol?: string,
  platform?: string,
): Promise<{ sensors: PCBPartsSensor[]; offline: boolean }> {
  const params = new URLSearchParams({ measurement });
  if (protocol) params.set('protocol', protocol);
  if (platform) params.set('platform', platform);
  try {
    const resp = await fetch(`${BASE}/sensors?${params}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { sensors: [], offline: true };
    return await resp.json();
  } catch {
    return { sensors: [], offline: true };
  }
}

// ─── KiCad Symbol/Footprint Download ────────────────────────────────────────

export async function downloadKiCadSymbol(
  cseId: string,
): Promise<{ symbol: any | null; offline: boolean }> {
  try {
    const resp = await fetch(`${BASE}/kicad/${cseId}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return { symbol: null, offline: true };
    return await resp.json();
  } catch {
    return { symbol: null, offline: true };
  }
}

// ─── Reference Boards ───────────────────────────────────────────────────────

export async function searchBoards(
  query: string,
): Promise<{ boards: any[]; offline: boolean }> {
  try {
    const resp = await fetch(`${BASE}/boards?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return { boards: [], offline: true };
    return await resp.json();
  } catch {
    return { boards: [], offline: true };
  }
}

// ─── Design Rules ───────────────────────────────────────────────────────────

export async function getDesignRules(
  topic?: string,
): Promise<{ rules: any[]; offline: boolean }> {
  const params = topic ? `?topic=${encodeURIComponent(topic)}` : '';
  try {
    const resp = await fetch(`${BASE}/design-rules${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return { rules: [], offline: true };
    return await resp.json();
  } catch {
    return { rules: [], offline: true };
  }
}
