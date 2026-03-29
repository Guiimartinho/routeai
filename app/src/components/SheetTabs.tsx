// ─── SheetTabs.tsx ─ Tab bar for hierarchical multi-sheet schematics ────────
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { theme } from '../styles/theme';

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    height: '28px',
    background: theme.bg1,
    borderTop: theme.border,
    padding: '0 4px',
    gap: '2px',
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    userSelect: 'none',
    flexShrink: 0,
    overflow: 'hidden',
  },
  tabsScroll: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    flex: 1,
    overflow: 'hidden',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 10px',
    borderRadius: '4px 4px 0 0',
    cursor: 'pointer',
    color: theme.textMuted,
    background: 'transparent',
    border: 'none',
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    whiteSpace: 'nowrap' as const,
    position: 'relative' as const,
    transition: 'background 0.15s, color 0.15s',
  },
  tabActive: {
    color: theme.blue,
    background: theme.bg2,
    borderBottom: `2px solid ${theme.blue}`,
  },
  tabHover: {
    background: theme.bg3,
    color: theme.textSecondary,
  },
  addBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '22px',
    borderRadius: '4px',
    cursor: 'pointer',
    color: theme.textMuted,
    background: 'transparent',
    border: 'none',
    fontSize: '14px',
    fontWeight: 700,
    transition: 'background 0.15s, color 0.15s',
  },
  badge: {
    fontSize: '9px',
    color: theme.textMuted,
    background: theme.bg3,
    borderRadius: '6px',
    padding: '0 4px',
    marginLeft: '4px',
    lineHeight: '14px',
  },
  contextMenu: {
    position: 'fixed' as const,
    background: theme.bg2,
    border: theme.border,
    borderRadius: '6px',
    padding: '4px 0',
    zIndex: 9999,
    minWidth: '140px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  menuItem: {
    display: 'block',
    width: '100%',
    padding: '4px 12px',
    background: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    textAlign: 'left' as const,
    cursor: 'pointer',
    transition: 'background 0.1s',
  },
  menuItemDanger: {
    color: theme.red,
  },
  renameInput: {
    background: theme.bg0,
    border: theme.borderFocus,
    borderRadius: '3px',
    color: theme.blue,
    fontSize: theme.fontSm,
    fontFamily: theme.fontMono,
    padding: '1px 4px',
    outline: 'none',
    width: '80px',
  },
  sheetCount: {
    fontSize: '9px',
    color: theme.textMuted,
    marginLeft: 'auto',
    paddingRight: '4px',
    flexShrink: 0,
  },
};

// ─── Context Menu Component ──────────────────────────────────────────────────

interface ContextMenuProps {
  x: number;
  y: number;
  sheetId: string;
  sheetCount: number;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function TabContextMenu({ x, y, sheetId, sheetCount, onRename, onDuplicate, onDelete, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={menuRef} style={{ ...styles.contextMenu, left: x, top: y }}>
      <button
        style={styles.menuItem}
        onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg3)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => { onRename(); onClose(); }}
      >
        Rename Sheet
      </button>
      <button
        style={styles.menuItem}
        onMouseEnter={(e) => (e.currentTarget.style.background = theme.bg3)}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        onClick={() => { onDuplicate(); onClose(); }}
      >
        Duplicate Sheet
      </button>
      {sheetCount > 1 && (
        <button
          style={{ ...styles.menuItem, ...styles.menuItemDanger }}
          onMouseEnter={(e) => (e.currentTarget.style.background = theme.redDim)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onDelete(); onClose(); }}
        >
          Delete Sheet
        </button>
      )}
    </div>
  );
}

// ─── SheetTabs Component ─────────────────────────────────────────────────────

const SheetTabs: React.FC = () => {
  const sheets = useProjectStore((s) => s.schematic.sheets);
  const activeSheetId = useProjectStore((s) => s.schematic.activeSheetId);
  const addSheet = useProjectStore((s) => s.addSheet);
  const removeSheet = useProjectStore((s) => s.removeSheet);
  const renameSheet = useProjectStore((s) => s.renameSheet);
  const switchSheet = useProjectStore((s) => s.switchSheet);
  const duplicateSheet = useProjectStore((s) => s.duplicateSheet);

  const [hoveredTab, setHoveredTab] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sheetId: string } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleTabClick = useCallback((id: string) => {
    if (renamingId) return;
    switchSheet(id);
  }, [switchSheet, renamingId]);

  const handleContextMenuOpen = useCallback((e: React.MouseEvent, sheetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, sheetId });
  }, []);

  const handleStartRename = useCallback((sheetId: string) => {
    const sheet = sheets.find((s) => s.id === sheetId);
    if (sheet) {
      setRenamingId(sheetId);
      setRenameValue(sheet.name);
    }
  }, [sheets]);

  const handleFinishRename = useCallback(() => {
    if (renamingId && renameValue.trim()) {
      renameSheet(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameSheet]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishRename();
    } else if (e.key === 'Escape') {
      setRenamingId(null);
    }
  }, [handleFinishRename]);

  const handleDeleteSheet = useCallback((sheetId: string) => {
    const sheet = sheets.find((s) => s.id === sheetId);
    if (!sheet) return;
    const hasContent = sheet.components.length > 0 || sheet.wires.length > 0 || sheet.labels.length > 0;
    if (hasContent) {
      if (!window.confirm(`Delete sheet "${sheet.name}"? It contains ${sheet.components.length} components, ${sheet.wires.length} wires, and ${sheet.labels.length} labels.`)) {
        return;
      }
    }
    removeSheet(sheetId);
  }, [sheets, removeSheet]);

  const handleAddSheet = useCallback(() => {
    const nextNum = sheets.length + 1;
    addSheet(`Sheet ${nextNum}`);
  }, [sheets.length, addSheet]);

  // Drag to reorder
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Make drag image semi-transparent
    if (e.currentTarget instanceof HTMLElement) {
      e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (dragId && dragId !== targetId) {
      // Reorder: move dragId sheet before targetId
      const store = useProjectStore.getState();
      const currentSheets = [...store.schematic.sheets];
      const dragIdx = currentSheets.findIndex((s) => s.id === dragId);
      const targetIdx = currentSheets.findIndex((s) => s.id === targetId);
      if (dragIdx >= 0 && targetIdx >= 0) {
        const [moved] = currentSheets.splice(dragIdx, 1);
        currentSheets.splice(targetIdx, 0, moved);
        store.reorderSheets(currentSheets.map((s) => s.id));
      }
    }
    setDragId(null);
    setDragOverId(null);
  }, [dragId]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  const itemCount = useCallback((sheet: typeof sheets[0]) => {
    return sheet.components.length + sheet.wires.length + sheet.labels.length;
  }, []);

  return (
    <div style={styles.bar}>
      <div style={styles.tabsScroll}>
        {sheets.map((sheet) => {
          const isActive = sheet.id === activeSheetId;
          const isHovered = hoveredTab === sheet.id;
          const isDragOver = dragOverId === sheet.id;

          const tabStyle: React.CSSProperties = {
            ...styles.tab,
            ...(isActive ? styles.tabActive : {}),
            ...(!isActive && isHovered ? styles.tabHover : {}),
            ...(isDragOver ? { borderLeft: `2px solid ${theme.blue}` } : {}),
          };

          return (
            <div
              key={sheet.id}
              style={tabStyle}
              onClick={() => handleTabClick(sheet.id)}
              onContextMenu={(e) => handleContextMenuOpen(e, sheet.id)}
              onMouseEnter={() => setHoveredTab(sheet.id)}
              onMouseLeave={() => setHoveredTab(null)}
              onDoubleClick={() => handleStartRename(sheet.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, sheet.id)}
              onDragOver={(e) => handleDragOver(e, sheet.id)}
              onDrop={(e) => handleDrop(e, sheet.id)}
              onDragEnd={handleDragEnd}
            >
              {renamingId === sheet.id ? (
                <input
                  ref={renameInputRef}
                  style={styles.renameInput}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={handleRenameKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  {sheet.name}
                  {itemCount(sheet) > 0 && (
                    <span style={styles.badge}>{itemCount(sheet)}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Add sheet button */}
      <button
        style={styles.addBtn}
        title="Add new sheet"
        onClick={handleAddSheet}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme.bg3;
          e.currentTarget.style.color = theme.blue;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = theme.textMuted;
        }}
      >
        +
      </button>

      {/* Sheet count */}
      <span style={styles.sheetCount}>{sheets.length} sheet{sheets.length !== 1 ? 's' : ''}</span>

      {/* Context menu */}
      {contextMenu && (
        <TabContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sheetId={contextMenu.sheetId}
          sheetCount={sheets.length}
          onRename={() => handleStartRename(contextMenu.sheetId)}
          onDuplicate={() => duplicateSheet(contextMenu.sheetId)}
          onDelete={() => handleDeleteSheet(contextMenu.sheetId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default SheetTabs;
