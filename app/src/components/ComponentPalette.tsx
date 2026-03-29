// ─── ComponentPalette.tsx ─ Left sidebar component library ─────────────────
import React, { useState, useMemo, useCallback } from 'react';
import type { LibComponent } from '../types';
import { theme } from '../styles/theme';
import { useEditorStore } from '../store/editorStore';
import { componentLibrary, enrichWithKiCadSymbol } from '../store/componentLibrary';
import { SYMBOL_DEFS, SymbolThumbnail } from './SymbolLibrary';
import ComponentSearch from './ComponentSearch';
import type { ComponentSearchResult } from '../api/componentSearch';

// ─── Full component library (111+ components from store/componentLibrary.ts) ──
// Re-export for backward compatibility with other imports
export const COMPONENT_LIBRARY: LibComponent[] = componentLibrary;

// ─── Styles ────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  container: {
    width: theme.sidebarWidth,
    minWidth: theme.panelMinWidth,
    height: '100%',
    background: theme.bg1,
    borderRight: theme.border,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    userSelect: 'none',
  },
  header: {
    padding: `${theme.sp2} ${theme.sp3}`,
    borderBottom: theme.border,
    fontSize: theme.fontSm,
    color: theme.textSecondary,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  searchWrap: {
    padding: theme.sp2,
    borderBottom: theme.border,
  },
  searchInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: `${theme.sp1} ${theme.sp2}`,
    background: theme.bg0,
    border: theme.border,
    borderRadius: theme.radiusSm,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    outline: 'none',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const,
  },
  categoryHeader: {
    padding: `${theme.sp1} ${theme.sp3}`,
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: theme.bg2,
    borderBottom: theme.border,
  },
  categoryCount: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    background: theme.bg3,
    padding: '1px 6px',
    borderRadius: theme.radiusFull,
  },
  compItem: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.sp2,
    padding: `${theme.sp1} ${theme.sp3}`,
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.bg2}`,
    transition: 'background 0.1s',
  },
  compItemHover: {
    background: theme.bg3,
  },
  compItemSelected: {
    background: theme.blueDim,
    borderLeft: `2px solid ${theme.blue}`,
  },
  compName: {
    fontSize: theme.fontSm,
    color: theme.textPrimary,
    fontFamily: theme.fontSans,
    flex: 1,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  compDesc: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    fontFamily: theme.fontSans,
  },
  starBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    padding: '2px',
    lineHeight: 1,
  },
  sectionLabel: {
    padding: `${theme.sp1} ${theme.sp3}`,
    fontSize: theme.fontXs,
    color: theme.orange,
    fontFamily: theme.fontSans,
    fontWeight: 600,
    background: theme.orangeDim,
    borderBottom: theme.border,
  },
};

// ─── Component ─────────────────────────────────────────────────────────────
const ComponentPalette: React.FC = () => {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [searchDialogOpen, setSearchDialogOpen] = useState(false);
  const [searchDialogQuery, setSearchDialogQuery] = useState('');
  const [onlineRecents, setOnlineRecents] = useState<ComponentSearchResult[]>([]);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  const {
    placingComponent, setPlacingComponent, addRecentlyUsed,
    favorites, toggleFavorite, recentlyUsed,
  } = useEditorStore();

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return COMPONENT_LIBRARY;
    const q = search.toLowerCase();
    return COMPONENT_LIBRARY.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  }, [search]);

  // Group by category
  const categories = useMemo(() => {
    const map = new Map<string, LibComponent[]>();
    filtered.forEach(c => {
      const arr = map.get(c.category) || [];
      arr.push(c);
      map.set(c.category, arr);
    });
    return map;
  }, [filtered]);

  // Recently used items
  const recentItems = useMemo(() => {
    return recentlyUsed
      .map(id => COMPONENT_LIBRARY.find(c => c.id === id))
      .filter(Boolean) as LibComponent[];
  }, [recentlyUsed]);

  // Favorite items
  const favItems = useMemo(() => {
    return favorites
      .map(id => COMPONENT_LIBRARY.find(c => c.id === id))
      .filter(Boolean) as LibComponent[];
  }, [favorites]);

  const handleSelect = useCallback(async (comp: LibComponent) => {
    addRecentlyUsed(comp.id);
    // Show loading state while enriching with KiCad symbol data
    setEnrichingId(comp.id);
    try {
      const enriched = await Promise.race([
        enrichWithKiCadSymbol({ ...comp }),
        new Promise<LibComponent>((resolve) => setTimeout(() => resolve(comp), 5000)),
      ]);
      setPlacingComponent(enriched);
    } catch {
      // Enrichment failed — proceed with generic symbol but warn
      console.warn(`[ComponentPalette] Symbol enrichment failed for "${comp.name}". Using generic symbol.`);
      setPlacingComponent(comp);
    } finally {
      setEnrichingId(null);
    }
  }, [setPlacingComponent, addRecentlyUsed]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  const handleDragStart = useCallback((e: React.DragEvent, comp: LibComponent) => {
    e.dataTransfer.setData('application/eda-component', JSON.stringify(comp));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  // Open the full search dialog
  const openSearchDialog = useCallback((query?: string) => {
    setSearchDialogQuery(query || '');
    setSearchDialogOpen(true);
  }, []);

  // Handle search input: open dialog on Enter or 3+ characters
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      openSearchDialog(search);
    }
  }, [search, openSearchDialog]);

  // Convert an online search result to a LibComponent for placement.
  // Returns a base component with generic IC pins; real pins are resolved
  // asynchronously via enrichWithKiCadSymbol before placement.
  const onlineResultToLibComponent = useCallback((result: ComponentSearchResult): LibComponent => {
    return {
      id: `online_${result.source}_${result.mpn}_${Date.now()}`,
      name: result.mpn || result.description.slice(0, 30),
      category: result.category || 'Online',
      subcategory: result.source,
      symbol: 'ic', // Default to generic IC symbol
      footprint: result.package || '',
      pins: SYMBOL_DEFS.ic?.pins || [],
      description: result.description,
      datasheetUrl: result.datasheet || '',
      mpn: result.mpn,
      manufacturer: result.manufacturer,
    };
  }, []);

  // Build a LibComponent from an online result AND try to fetch real pin data
  // from the backend symbol endpoint before returning.
  const enrichOnlineResult = useCallback(async (result: ComponentSearchResult): Promise<LibComponent> => {
    const comp = onlineResultToLibComponent(result);
    if (!result.hasSymbol && !result.mpn) return comp;
    try {
      const enriched = await Promise.race([
        enrichWithKiCadSymbol({ ...comp }),
        new Promise<LibComponent>((resolve) => setTimeout(() => resolve(comp), 5000)),
      ]);
      return enriched;
    } catch {
      console.warn(`[ComponentPalette] Failed to fetch symbol pins for online part "${result.mpn}". Using generic IC pins.`);
      return comp;
    }
  }, [onlineResultToLibComponent]);

  // Place an online component in the schematic — await enrichment first
  const handlePlaceOnlineSchematic = useCallback(async (result: ComponentSearchResult) => {
    const baseComp = onlineResultToLibComponent(result);
    // Track in online recents (keep last 10)
    setOnlineRecents(prev => {
      const filtered = prev.filter(r => r.mpn !== result.mpn);
      return [result, ...filtered].slice(0, 10);
    });
    // Show loading indicator while fetching real pin data
    setEnrichingId(baseComp.id);
    try {
      const enriched = await enrichOnlineResult(result);
      setPlacingComponent(enriched);
      addRecentlyUsed(enriched.id);
    } catch {
      console.warn(`[ComponentPalette] Enrichment failed for online part "${result.mpn}". Placing with generic symbol.`);
      setPlacingComponent(baseComp);
      addRecentlyUsed(baseComp.id);
    } finally {
      setEnrichingId(null);
    }
  }, [onlineResultToLibComponent, enrichOnlineResult, setPlacingComponent, addRecentlyUsed]);

  // Place an online component footprint on the board
  const handlePlaceOnlineBoard = useCallback((result: ComponentSearchResult) => {
    const comp = onlineResultToLibComponent(result);
    // For board placement, we still go through the same flow
    setPlacingComponent(comp);
    addRecentlyUsed(comp.id);
    setOnlineRecents(prev => {
      const filtered = prev.filter(r => r.mpn !== result.mpn);
      return [result, ...filtered].slice(0, 10);
    });
  }, [onlineResultToLibComponent, setPlacingComponent, addRecentlyUsed]);

  const renderItem = (comp: LibComponent) => {
    const isSelected = placingComponent?.id === comp.id;
    const isHovered = hoveredItem === comp.id;
    const isFav = favorites.includes(comp.id);
    const isEnriching = enrichingId === comp.id;

    return (
      <div
        key={comp.id}
        style={{
          ...styles.compItem,
          ...(isHovered ? styles.compItemHover : {}),
          ...(isSelected ? styles.compItemSelected : {}),
          ...(isEnriching ? { opacity: 0.7, pointerEvents: 'none' as const } : {}),
        }}
        onClick={() => handleSelect(comp)}
        onMouseEnter={() => setHoveredItem(comp.id)}
        onMouseLeave={() => setHoveredItem(null)}
        draggable
        onDragStart={(e) => handleDragStart(e, comp)}
      >
        {isEnriching ? (
          <div style={{
            width: 28, height: 28, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: '10px', color: theme.blue,
            fontFamily: theme.fontSans, fontWeight: 700,
            animation: 'spin 1s linear infinite',
          }}>...</div>
        ) : (
          <SymbolThumbnail type={comp.symbol} size={28} />
        )}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={styles.compName}>
            {isEnriching ? `Loading ${comp.name}...` : comp.name}
          </div>
          <div style={styles.compDesc}>{comp.footprint}</div>
        </div>
        <button
          style={{
            ...styles.starBtn,
            color: isFav ? theme.orange : theme.textMuted,
          }}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(comp.id); }}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >
          {isFav ? '\u2605' : '\u2606'}
        </button>
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>Components</div>

      <div style={styles.searchWrap}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search components... (Enter for online)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            // Auto-open dialog at 3+ characters
            if (e.target.value.length >= 3 && !searchDialogOpen) {
              // Don't auto-open, but show a hint
            }
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <div style={{
          display: 'flex',
          gap: '4px',
          marginTop: theme.sp1,
        }}>
          <button
            style={{
              flex: 1,
              padding: `3px ${theme.sp2}`,
              background: theme.blueDim,
              color: theme.blue,
              border: 'none',
              borderRadius: theme.radiusSm,
              fontSize: theme.fontXs,
              fontFamily: theme.fontSans,
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => openSearchDialog(search)}
          >
            Search Online
          </button>
          <button
            style={{
              flex: 1,
              padding: `3px ${theme.sp2}`,
              background: theme.greenDim,
              color: theme.green,
              border: 'none',
              borderRadius: theme.radiusSm,
              fontSize: theme.fontXs,
              fontFamily: theme.fontSans,
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => openSearchDialog('')}
          >
            Browse LCSC
          </button>
        </div>
      </div>

      <div style={styles.list}>
        {/* Favorites section */}
        {favItems.length > 0 && !search && (
          <>
            <div style={styles.sectionLabel}>Favorites</div>
            {favItems.map(renderItem)}
          </>
        )}

        {/* Recently used from online search */}
        {onlineRecents.length > 0 && !search && (
          <>
            <div style={{
              ...styles.sectionLabel,
              color: theme.green,
              background: theme.greenDim,
            }}>Online Recent</div>
            {onlineRecents.slice(0, 5).map((result, idx) => {
              const comp = onlineResultToLibComponent(result);
              const isHovered = hoveredItem === comp.id;
              return (
                <div
                  key={`online-recent-${idx}`}
                  style={{
                    ...styles.compItem,
                    ...(isHovered ? styles.compItemHover : {}),
                  }}
                  onClick={() => handlePlaceOnlineSchematic(result)}
                  onMouseEnter={() => setHoveredItem(comp.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <div style={{
                    width: 28,
                    height: 28,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: theme.greenDim,
                    borderRadius: theme.radiusSm,
                    fontSize: '9px',
                    color: theme.green,
                    fontWeight: 700,
                    fontFamily: theme.fontSans,
                  }}>
                    {result.source === 'lcsc' ? 'LC' : result.source === 'kicad' ? 'Ki' : 'LO'}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <div style={styles.compName}>{result.mpn || result.description.slice(0, 20)}</div>
                    <div style={styles.compDesc}>{result.manufacturer} {result.package}</div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Recently used section */}
        {recentItems.length > 0 && !search && (
          <>
            <div style={styles.sectionLabel}>Recently Used</div>
            {recentItems.slice(0, 5).map(renderItem)}
          </>
        )}

        {/* Categories */}
        {Array.from(categories.entries()).map(([cat, items]) => (
          <div key={cat}>
            <div
              style={styles.categoryHeader}
              onClick={() => toggleCategory(cat)}
            >
              <span>{collapsed[cat] ? '\u25B6' : '\u25BC'} {cat}</span>
              <span style={styles.categoryCount}>{items.length}</span>
            </div>
            {!collapsed[cat] && items.map(renderItem)}
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{
            padding: theme.sp4,
            color: theme.textMuted,
            fontSize: theme.fontSm,
            textAlign: 'center' as const,
            fontFamily: theme.fontSans,
          }}>
            No components found
            <br />
            <button
              style={{
                marginTop: theme.sp2,
                background: 'none',
                border: 'none',
                color: theme.blue,
                cursor: 'pointer',
                fontSize: theme.fontSm,
                textDecoration: 'underline',
                fontFamily: theme.fontSans,
              }}
              onClick={() => openSearchDialog(search)}
            >
              Search online libraries
            </button>
          </div>
        )}
      </div>

      {/* Full-screen component search dialog */}
      <ComponentSearch
        open={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
        onPlaceInSchematic={handlePlaceOnlineSchematic}
        onPlaceInBoard={handlePlaceOnlineBoard}
        initialQuery={searchDialogQuery}
      />
    </div>
  );
};

export default ComponentPalette;
