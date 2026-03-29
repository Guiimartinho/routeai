// ─── componentSearch.ts ─ Unified component search across multiple sources ───
//
// Search flow:
//   1. Search local KiCad library index (instant)
//   2. Search jlcsearch / LCSC APIs (free, no auth)
//   3. Merge and deduplicate results
//   4. Cache results for 5 minutes

import { KICAD_LIBRARY_INDEX, type KicadIndexEntry } from './kicadLibrary';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ComponentPriceBreak {
  qty: number;
  price: number;
}

export interface ComponentSearchResult {
  mpn: string;
  manufacturer: string;
  description: string;
  category: string;
  package: string;
  price?: ComponentPriceBreak[];
  stock?: number;
  datasheet?: string;
  imageUrl?: string;
  lcscCode?: string;
  source: 'local' | 'lcsc' | 'kicad' | 'digikey';
  hasSymbol: boolean;
  hasFootprint: boolean;
}

export interface ComponentSearchOptions {
  category?: string;
  limit?: number;
  sources?: Array<'local' | 'lcsc' | 'kicad'>;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  results: ComponentSearchResult[];
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const searchCache = new Map<string, CacheEntry>();

function getCacheKey(query: string, options?: ComponentSearchOptions): string {
  return `${query}|${options?.category ?? ''}|${options?.limit ?? 40}`;
}

function getCached(key: string): ComponentSearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

function setCache(key: string, results: ComponentSearchResult[]) {
  searchCache.set(key, { results, timestamp: Date.now() });
  // Evict old entries if cache gets too large
  if (searchCache.size > 200) {
    const oldest = Array.from(searchCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 50);
    oldest.forEach(([k]) => searchCache.delete(k));
  }
}

// ─── Local (KiCad index) search ─────────────────────────────────────────────

function searchLocalLibrary(query: string, category?: string, limit = 40): ComponentSearchResult[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);

  let matches = KICAD_LIBRARY_INDEX.filter((entry: KicadIndexEntry) => {
    const text = `${entry.name} ${entry.description} ${entry.category} ${entry.lib_file}`.toLowerCase();
    const matchesQuery = tokens.every(tok => text.includes(tok));
    const matchesCat = !category || entry.category.toLowerCase().includes(category.toLowerCase());
    return matchesQuery && matchesCat;
  });

  // Score: prefer exact name match, then description
  matches.sort((a, b) => {
    const aExact = a.name.toLowerCase().includes(q) ? 0 : 1;
    const bExact = b.name.toLowerCase().includes(q) ? 0 : 1;
    return aExact - bExact;
  });

  return matches.slice(0, limit).map(entry => ({
    mpn: entry.name,
    manufacturer: '',
    description: entry.description,
    category: entry.category,
    package: entry.footprint_suggestion || '',
    source: 'kicad' as const,
    hasSymbol: true,
    hasFootprint: !!entry.footprint_suggestion,
  }));
}

// ─── jlcsearch API (tscircuit) ──────────────────────────────────────────────

interface JlcComponent {
  lcsc: string;
  mfr: string;
  package: string;
  description: string;
  stock: number;
  manufacturer: string;
  category?: string;
  subcategory?: string;
  price?: number;
  datasheet?: string;
  image_url?: string;
  prices?: Array<{ qty: number; price: number }>;
}

async function searchJlcsearch(query: string, limit = 20): Promise<ComponentSearchResult[]> {
  try {
    const url = new URL('https://jlcsearch.tscircuit.com/api/components/list.json');
    url.searchParams.set('search', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('full', 'true');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`jlcsearch returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    const components: JlcComponent[] = data.components || data || [];

    return components.map((c: JlcComponent) => ({
      mpn: c.mfr || c.lcsc || '',
      manufacturer: c.manufacturer || '',
      description: c.description || '',
      category: c.subcategory || c.category || '',
      package: c.package || '',
      price: c.prices?.map(p => ({ qty: p.qty, price: p.price }))
        || (c.price != null ? [{ qty: 1, price: c.price }] : undefined),
      stock: c.stock,
      datasheet: c.datasheet || undefined,
      imageUrl: c.image_url || undefined,
      lcscCode: c.lcsc || undefined,
      source: 'lcsc' as const,
      hasSymbol: false,
      hasFootprint: true, // LCSC parts have footprints via JLCPCB
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn('jlcsearch request timed out');
    } else {
      console.warn('jlcsearch error:', err);
    }
    return [];
  }
}

// ─── LCSC direct search (fallback) ─────────────────────────────────────────

interface LcscProduct {
  productCode?: string;
  productModel?: string;
  brandNameEn?: string;
  productDescEn?: string;
  encapStandard?: string;
  stockNumber?: number;
  pdfUrl?: string;
  productImageUrl?: string;
  productPriceList?: Array<{ ladder: number; usdPrice: number }>;
  catalogName?: string;
}

async function searchLcscDirect(query: string, limit = 20): Promise<ComponentSearchResult[]> {
  try {
    const url = `https://wmsc.lcsc.com/ftps/wm/search/global?keyword=${encodeURIComponent(query)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`LCSC search returned ${response.status}`);
      return [];
    }

    const data = await response.json();
    const products: LcscProduct[] = data?.result?.tipProductList
      || data?.result?.productList
      || [];

    return products.slice(0, limit).map((p: LcscProduct) => ({
      mpn: p.productModel || '',
      manufacturer: p.brandNameEn || '',
      description: p.productDescEn || '',
      category: p.catalogName || '',
      package: p.encapStandard || '',
      price: p.productPriceList?.map(pp => ({
        qty: pp.ladder,
        price: pp.usdPrice,
      })),
      stock: p.stockNumber,
      datasheet: p.pdfUrl || undefined,
      imageUrl: p.productImageUrl || undefined,
      lcscCode: p.productCode || undefined,
      source: 'lcsc' as const,
      hasSymbol: false,
      hasFootprint: true,
    }));
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn('LCSC search timed out');
    } else {
      console.warn('LCSC search error:', err);
    }
    return [];
  }
}

// ─── Deduplication ──────────────────────────────────────────────────────────

function deduplicateResults(results: ComponentSearchResult[]): ComponentSearchResult[] {
  const seen = new Map<string, ComponentSearchResult>();

  for (const r of results) {
    // Create a key from mpn + manufacturer (normalized)
    const key = `${r.mpn.toLowerCase().replace(/\s+/g, '')}|${r.manufacturer.toLowerCase()}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
    } else {
      // Merge: prefer the one with more data
      if (r.price && !existing.price) existing.price = r.price;
      if (r.stock != null && existing.stock == null) existing.stock = r.stock;
      if (r.datasheet && !existing.datasheet) existing.datasheet = r.datasheet;
      if (r.imageUrl && !existing.imageUrl) existing.imageUrl = r.imageUrl;
      if (r.lcscCode && !existing.lcscCode) existing.lcscCode = r.lcscCode;
      if (r.hasSymbol) existing.hasSymbol = true;
      if (r.hasFootprint) existing.hasFootprint = true;
    }
  }

  return Array.from(seen.values());
}

// ─── Backend proxy search (avoids CORS, has LCSC + SnapEDA + local DB) ──────

async function searchBackend(query: string, category?: string, limit = 40): Promise<ComponentSearchResult[]> {
  try {
    // Use relative URL so Vite proxy handles it (avoids CORS)
    const url = new URL('/api/components/search', window.location.origin);
    url.searchParams.set('q', query);
    if (category) url.searchParams.set('category', category);
    url.searchParams.set('limit', String(limit));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    const results = data.results || [];

    return results.map((r: any) => ({
      mpn: r.mpn || '',
      manufacturer: r.manufacturer || '',
      description: r.description || '',
      category: r.category || '',
      package: r.package || '',
      price: r.price_usd != null ? [{ qty: 1, price: r.price_usd }] : undefined,
      stock: r.stock,
      datasheet: r.datasheet_url || undefined,
      lcscCode: r.lcsc_code || undefined,
      source: (r.source || 'local') as 'local' | 'lcsc' | 'kicad' | 'digikey',
      hasSymbol: r.has_symbol ?? false,
      hasFootprint: r.has_footprint ?? false,
    }));
  } catch (err) {
    console.warn('Backend component search failed:', err);
    return [];
  }
}

// ─── Main search function ───────────────────────────────────────────────────

export async function searchComponents(
  query: string,
  options?: ComponentSearchOptions,
): Promise<ComponentSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const limit = options?.limit ?? 40;
  const cacheKey = getCacheKey(q, options);

  // Check cache
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // 1. Search backend (has built-in DB + LCSC proxy + SnapEDA)
  const backendResults = await searchBackend(q, options?.category, limit);

  // 2. Also search local KiCad index (instant, no network)
  const localResults = searchLocalLibrary(q, options?.category, limit);

  // 3. Merge & deduplicate
  let all = deduplicateResults([...backendResults, ...localResults]);

  // Sort: parts with stock first, then by source reliability
  all.sort((a, b) => {
    if (a.stock != null && b.stock == null) return -1;
    if (b.stock != null && a.stock == null) return 1;
    if (a.stock != null && b.stock != null) return b.stock - a.stock;
    if (a.source === 'lcsc' && b.source !== 'lcsc') return -1;
    if (b.source === 'lcsc' && a.source !== 'lcsc') return 1;
    return 0;
  });

  const results = all.slice(0, limit);
  setCache(cacheKey, results);
  return results;
}

// ─── Convenience exports ────────────────────────────────────────────────────

export function clearSearchCache() {
  searchCache.clear();
}

export function getCacheSize(): number {
  return searchCache.size;
}
