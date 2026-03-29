// ─── ComponentSearch.tsx ─ Full-screen component search dialog ───────────────
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { theme } from '../styles/theme';
import { searchComponents, type ComponentSearchResult, type ComponentPriceBreak } from '../api/componentSearch';

// ─── Category filter tabs ───────────────────────────────────────────────────

const CATEGORY_TABS = [
  { key: 'all', label: 'All' },
  { key: 'resistor', label: 'Resistors' },
  { key: 'capacitor', label: 'Capacitors' },
  { key: 'inductor', label: 'Inductors' },
  { key: 'diode', label: 'Diodes' },
  { key: 'transistor', label: 'Transistors' },
  { key: 'mosfet', label: 'MOSFETs' },
  { key: 'ic', label: 'ICs' },
  { key: 'mcu', label: 'MCUs' },
  { key: 'regulator', label: 'Regulators' },
  { key: 'connector', label: 'Connectors' },
  { key: 'sensor', label: 'Sensors' },
  { key: 'led', label: 'LEDs' },
  { key: 'memory', label: 'Memory' },
  { key: 'interface', label: 'Interface' },
] as const;

// ─── Source badge colors ────────────────────────────────────────────────────

const SOURCE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  lcsc:   { bg: theme.greenDim, text: theme.green,  label: 'LCSC' },
  local:  { bg: theme.blueDim,  text: theme.blue,   label: 'Local' },
  kicad:  { bg: theme.purpleDim, text: theme.purple, label: 'KiCad' },
  digikey:{ bg: theme.orangeDim, text: theme.orange, label: 'DigiKey' },
};

// ─── Stock color helper ─────────────────────────────────────────────────────

function stockColor(stock?: number): string {
  if (stock == null) return theme.textMuted;
  if (stock > 100) return theme.green;
  if (stock > 0) return theme.orange;
  return theme.red;
}

function stockLabel(stock?: number): string {
  if (stock == null) return '--';
  if (stock > 10000) return `${Math.floor(stock / 1000)}k+`;
  return stock.toLocaleString();
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
    zIndex: 10000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: theme.fontSans,
  },
  modal: {
    width: '95vw',
    maxWidth: 1200,
    height: '90vh',
    background: theme.bg1,
    borderRadius: theme.radiusLg,
    border: theme.border,
    boxShadow: theme.shadowLg,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp3,
    padding: `${theme.sp3} ${theme.sp4}`,
    borderBottom: theme.border,
    background: theme.bg2,
  },
  searchInput: {
    flex: 1,
    padding: `${theme.sp2} ${theme.sp3}`,
    background: theme.bg0,
    border: theme.border,
    borderRadius: theme.radiusMd,
    color: theme.textPrimary,
    fontSize: theme.fontMd,
    fontFamily: theme.fontSans,
    outline: 'none',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: theme.textMuted,
    fontSize: '20px',
    cursor: 'pointer',
    padding: theme.sp1,
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    gap: '2px',
    padding: `${theme.sp1} ${theme.sp4}`,
    background: theme.bg2,
    borderBottom: theme.border,
    overflowX: 'auto',
    flexShrink: 0,
  },
  tab: {
    padding: `${theme.sp1} ${theme.sp3}`,
    fontSize: theme.fontXs,
    color: theme.textMuted,
    background: 'none',
    border: 'none',
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: theme.fontSans,
  },
  tabActive: {
    background: theme.blueDim,
    color: theme.blue,
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  tableWrap: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.fontSm,
  },
  th: {
    position: 'sticky',
    top: 0,
    background: theme.bg2,
    color: theme.textSecondary,
    fontWeight: 600,
    textAlign: 'left',
    padding: `${theme.sp2} ${theme.sp3}`,
    borderBottom: theme.border,
    whiteSpace: 'nowrap',
    fontSize: theme.fontXs,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    zIndex: 1,
  },
  td: {
    padding: `${theme.sp2} ${theme.sp3}`,
    borderBottom: `1px solid ${theme.bg2}`,
    color: theme.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 260,
  },
  tr: {
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  trHover: {
    background: theme.bg3,
  },
  trSelected: {
    background: theme.blueDim,
  },
  badge: {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: theme.radiusFull,
    fontSize: '9px',
    fontWeight: 700,
    letterSpacing: '0.3px',
  },
  detail: {
    width: 340,
    borderLeft: theme.border,
    background: theme.bg2,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  detailHeader: {
    padding: theme.sp4,
    borderBottom: theme.border,
  },
  detailBody: {
    flex: 1,
    overflowY: 'auto',
    padding: theme.sp4,
  },
  detailTitle: {
    fontSize: theme.fontLg,
    fontWeight: 700,
    color: theme.textPrimary,
    marginBottom: theme.sp1,
  },
  detailMfr: {
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    marginBottom: theme.sp3,
  },
  detailSection: {
    marginBottom: theme.sp4,
  },
  detailLabel: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    marginBottom: theme.sp1,
  },
  detailValue: {
    fontSize: theme.fontSm,
    color: theme.textPrimary,
  },
  detailImage: {
    width: '100%',
    maxHeight: 160,
    objectFit: 'contain',
    borderRadius: theme.radiusMd,
    background: theme.bg0,
    marginBottom: theme.sp3,
  },
  priceTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: theme.fontXs,
  },
  priceTh: {
    textAlign: 'left',
    padding: `${theme.sp1} ${theme.sp2}`,
    color: theme.textMuted,
    fontWeight: 600,
    borderBottom: theme.border,
  },
  priceTd: {
    padding: `${theme.sp1} ${theme.sp2}`,
    color: theme.textPrimary,
    borderBottom: `1px solid ${theme.bg3}`,
  },
  actions: {
    padding: theme.sp3,
    borderTop: theme.border,
    display: 'flex',
    gap: theme.sp2,
  },
  btnPrimary: {
    flex: 1,
    padding: `${theme.sp2} ${theme.sp3}`,
    background: theme.blue,
    color: '#fff',
    border: 'none',
    borderRadius: theme.radiusMd,
    fontSize: theme.fontSm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  btnSecondary: {
    flex: 1,
    padding: `${theme.sp2} ${theme.sp3}`,
    background: theme.bg3,
    color: theme.textPrimary,
    border: theme.border,
    borderRadius: theme.radiusMd,
    fontSize: theme.fontSm,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: theme.fontSans,
  },
  statusBar: {
    padding: `${theme.sp1} ${theme.sp4}`,
    background: theme.bg2,
    borderTop: theme.border,
    fontSize: theme.fontXs,
    color: theme.textMuted,
    display: 'flex',
    justifyContent: 'space-between',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp8,
    color: theme.textMuted,
    fontSize: theme.fontSm,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.sp8,
    color: theme.textMuted,
    fontSize: theme.fontSm,
    gap: theme.sp2,
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: theme.blue,
    cursor: 'pointer',
    fontSize: theme.fontSm,
    textDecoration: 'underline',
    fontFamily: theme.fontSans,
    padding: 0,
  },
};

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ComponentSearchProps {
  open: boolean;
  onClose: () => void;
  onPlaceInSchematic?: (result: ComponentSearchResult) => void;
  onPlaceInBoard?: (result: ComponentSearchResult) => void;
  initialQuery?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

const ComponentSearch: React.FC<ComponentSearchProps> = ({
  open,
  onClose,
  onPlaceInSchematic,
  onPlaceInBoard,
  initialQuery = '',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ComponentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ComponentSearchResult | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number>(-1);
  const [activeTab, setActiveTab] = useState('all');
  const [searchTime, setSearchTime] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Focus input on open
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Set initial query
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);

  // Debounced search
  const doSearch = useCallback(async (q: string, category?: string) => {
    if (!q.trim()) {
      setResults([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const t0 = performance.now();
    try {
      const res = await searchComponents(q, {
        category: category === 'all' ? undefined : category,
        limit: 60,
      });
      setResults(res);
      setSelected(null);
      setSearchTime(Math.round(performance.now() - t0));
    } catch (err) {
      console.error('Search failed:', err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, activeTab);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, activeTab, doSearch]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHoveredIdx(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHoveredIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && hoveredIdx >= 0 && results[hoveredIdx]) {
      setSelected(results[hoveredIdx]);
    }
  }, [onClose, results, hoveredIdx]);

  // Filter results based on category tab
  const filteredResults = useMemo(() => {
    if (activeTab === 'all') return results;
    const tab = activeTab.toLowerCase();
    return results.filter(r => {
      const text = `${r.category} ${r.description} ${r.mpn}`.toLowerCase();
      return text.includes(tab);
    });
  }, [results, activeTab]);

  const handlePlaceSchematic = useCallback(() => {
    if (selected && onPlaceInSchematic) {
      onPlaceInSchematic(selected);
      onClose();
    }
  }, [selected, onPlaceInSchematic, onClose]);

  const handlePlaceBoard = useCallback(() => {
    if (selected && onPlaceInBoard) {
      onPlaceInBoard(selected);
      onClose();
    }
  }, [selected, onPlaceInBoard, onClose]);

  if (!open) return null;

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={s.modal} onKeyDown={handleKeyDown}>
        {/* Header / search bar */}
        <div style={s.header}>
          <span style={{ color: theme.textSecondary, fontSize: theme.fontLg }}>
            {'\uD83D\uDD0D'}
          </span>
          <input
            ref={inputRef}
            style={s.searchInput}
            type="text"
            placeholder="Search components (e.g. STM32F103, 10k resistor, USB-C connector)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {loading && (
            <span style={{ color: theme.textMuted, fontSize: theme.fontXs }}>Searching...</span>
          )}
          <button style={s.closeBtn} onClick={onClose} title="Close (Esc)">{'\u2715'}</button>
        </div>

        {/* Category tabs */}
        <div style={s.tabs}>
          {CATEGORY_TABS.map(tab => (
            <button
              key={tab.key}
              style={{
                ...s.tab,
                ...(activeTab === tab.key ? s.tabActive : {}),
              }}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body: table + detail panel */}
        <div style={s.body}>
          {/* Results table */}
          <div style={s.tableWrap}>
            {loading && results.length === 0 ? (
              <div style={s.loading}>
                <span>Searching component libraries...</span>
              </div>
            ) : filteredResults.length === 0 && query.trim() ? (
              <div style={s.empty}>
                <span>No components found for "{query}"</span>
                <span style={{ fontSize: theme.fontXs }}>
                  Try different keywords or check spelling
                </span>
              </div>
            ) : filteredResults.length === 0 ? (
              <div style={s.empty}>
                <span>Type to search across LCSC, KiCad, and local libraries</span>
                <span style={{ fontSize: theme.fontXs, color: theme.textMuted }}>
                  Search by part number, description, or keyword
                </span>
              </div>
            ) : (
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>MPN</th>
                    <th style={s.th}>Manufacturer</th>
                    <th style={{ ...s.th, maxWidth: 300 }}>Description</th>
                    <th style={s.th}>Package</th>
                    <th style={s.th}>Price</th>
                    <th style={s.th}>Stock</th>
                    <th style={s.th}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, i) => {
                    const isSelected = selected === r;
                    const isHovered = hoveredIdx === i;
                    const badge = SOURCE_BADGE[r.source] || SOURCE_BADGE.local;

                    return (
                      <tr
                        key={`${r.mpn}-${r.source}-${i}`}
                        style={{
                          ...s.tr,
                          ...(isHovered ? s.trHover : {}),
                          ...(isSelected ? s.trSelected : {}),
                        }}
                        onClick={() => setSelected(r)}
                        onMouseEnter={() => setHoveredIdx(i)}
                        onMouseLeave={() => setHoveredIdx(-1)}
                      >
                        <td style={{ ...s.td, fontWeight: 600, color: theme.blue }}>
                          {r.mpn || '--'}
                        </td>
                        <td style={s.td}>{r.manufacturer || '--'}</td>
                        <td style={{ ...s.td, maxWidth: 300, color: theme.textSecondary }}>
                          {r.description || '--'}
                        </td>
                        <td style={{ ...s.td, fontFamily: theme.fontMono, fontSize: theme.fontXs }}>
                          {r.package || '--'}
                        </td>
                        <td style={s.td}>
                          {r.price && r.price.length > 0
                            ? `$${r.price[0].price.toFixed(4)}`
                            : '--'}
                        </td>
                        <td style={{ ...s.td, color: stockColor(r.stock), fontWeight: 600 }}>
                          {stockLabel(r.stock)}
                        </td>
                        <td style={s.td}>
                          <span style={{
                            ...s.badge,
                            background: badge.bg,
                            color: badge.text,
                          }}>
                            {badge.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div style={s.detail}>
              <div style={s.detailHeader}>
                {selected.imageUrl && (
                  <img
                    src={selected.imageUrl}
                    alt={selected.mpn}
                    style={s.detailImage}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div style={s.detailTitle}>{selected.mpn || 'Unknown'}</div>
                <div style={s.detailMfr}>{selected.manufacturer || 'Unknown manufacturer'}</div>
                <span style={{
                  ...s.badge,
                  background: (SOURCE_BADGE[selected.source] || SOURCE_BADGE.local).bg,
                  color: (SOURCE_BADGE[selected.source] || SOURCE_BADGE.local).text,
                }}>
                  {(SOURCE_BADGE[selected.source] || SOURCE_BADGE.local).label}
                </span>
              </div>

              <div style={s.detailBody}>
                {/* Description */}
                <div style={s.detailSection}>
                  <div style={s.detailLabel}>Description</div>
                  <div style={s.detailValue}>{selected.description || '--'}</div>
                </div>

                {/* Specs */}
                <div style={s.detailSection}>
                  <div style={s.detailLabel}>Details</div>
                  <table style={{ width: '100%', fontSize: theme.fontXs }}>
                    <tbody>
                      <tr>
                        <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>Category</td>
                        <td style={{ color: theme.textPrimary }}>{selected.category || '--'}</td>
                      </tr>
                      <tr>
                        <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>Package</td>
                        <td style={{ color: theme.textPrimary, fontFamily: theme.fontMono }}>
                          {selected.package || '--'}
                        </td>
                      </tr>
                      {selected.lcscCode && (
                        <tr>
                          <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>LCSC</td>
                          <td style={{ color: theme.blue }}>{selected.lcscCode}</td>
                        </tr>
                      )}
                      <tr>
                        <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>Stock</td>
                        <td style={{ color: stockColor(selected.stock), fontWeight: 600 }}>
                          {stockLabel(selected.stock)}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>Symbol</td>
                        <td style={{ color: selected.hasSymbol ? theme.green : theme.textMuted }}>
                          {selected.hasSymbol ? 'Available' : 'Not available'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ color: theme.textMuted, padding: '2px 8px 2px 0' }}>Footprint</td>
                        <td style={{ color: selected.hasFootprint ? theme.green : theme.textMuted }}>
                          {selected.hasFootprint ? 'Available' : 'Not available'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Datasheet link */}
                {selected.datasheet && (
                  <div style={s.detailSection}>
                    <div style={s.detailLabel}>Datasheet</div>
                    <a
                      href={selected.datasheet}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: theme.blue, fontSize: theme.fontSm, textDecoration: 'underline' }}
                    >
                      View Datasheet (PDF)
                    </a>
                  </div>
                )}

                {/* Pricing table */}
                {selected.price && selected.price.length > 0 && (
                  <div style={s.detailSection}>
                    <div style={s.detailLabel}>Pricing (USD)</div>
                    <table style={s.priceTable}>
                      <thead>
                        <tr>
                          <th style={s.priceTh}>Qty</th>
                          <th style={s.priceTh}>Unit Price</th>
                          <th style={s.priceTh}>Ext. Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.price.map((pb: ComponentPriceBreak, i: number) => (
                          <tr key={i}>
                            <td style={s.priceTd}>{pb.qty}+</td>
                            <td style={s.priceTd}>${pb.price.toFixed(4)}</td>
                            <td style={{ ...s.priceTd, color: theme.textSecondary }}>
                              ${(pb.qty * pb.price).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* LCSC product page link */}
                {selected.lcscCode && (
                  <div style={s.detailSection}>
                    <a
                      href={`https://www.lcsc.com/product-detail/${selected.lcscCode}.html`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: theme.blue, fontSize: theme.fontSm, textDecoration: 'underline' }}
                    >
                      View on LCSC
                    </a>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={s.actions}>
                <button
                  style={s.btnPrimary}
                  onClick={handlePlaceSchematic}
                  title="Add this component to the schematic"
                >
                  Place in Schematic
                </button>
                <button
                  style={s.btnSecondary}
                  onClick={handlePlaceBoard}
                  title="Add this footprint directly to the board"
                >
                  Place in Board
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div style={s.statusBar}>
          <span>
            {filteredResults.length > 0
              ? `${filteredResults.length} result${filteredResults.length !== 1 ? 's' : ''}`
              : 'Ready'}
          </span>
          {searchTime > 0 && results.length > 0 && (
            <span>{searchTime}ms</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComponentSearch;
