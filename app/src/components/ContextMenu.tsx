import React, { useEffect, useRef, useState, useCallback } from 'react';
import { theme } from '../styles/theme';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ContextTarget = 'component' | 'wire' | 'trace' | 'pad' | 'via' | 'zone' | 'empty';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  children?: ContextMenuItem[];
  separator?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  target: ContextTarget;
  targetId?: string;
  onAction: (actionId: string, targetId?: string) => void;
  onClose: () => void;
}

// ─── Menu definitions by context ────────────────────────────────────────────

const COMPONENT_ITEMS: ContextMenuItem[] = [
  { id: 'edit-properties', label: 'Edit Properties', icon: '\u2699', shortcut: 'E' },
  { id: 'separator-1', label: '', separator: true },
  { id: 'rotate', label: 'Rotate', icon: '\u21BB', shortcut: 'R' },
  { id: 'flip', label: 'Flip', icon: '\u2195', shortcut: 'F' },
  { id: 'separator-2', label: '', separator: true },
  { id: 'copy', label: 'Copy', icon: '\u2398', shortcut: 'Ctrl+C' },
  { id: 'cut', label: 'Cut', icon: '\u2702', shortcut: 'Ctrl+X' },
  { id: 'duplicate', label: 'Duplicate', icon: '\u29C9', shortcut: 'Ctrl+D' },
  { id: 'separator-3', label: '', separator: true },
  { id: 'delete', label: 'Delete', icon: '\u2716', shortcut: 'Del', danger: true },
];

const WIRE_TRACE_ITEMS: ContextMenuItem[] = [
  { id: 'delete-segment', label: 'Delete Segment', icon: '\u2716', shortcut: 'Del' },
  { id: 'split', label: 'Split at Point', icon: '\u2702' },
  { id: 'separator-1', label: '', separator: true },
  {
    id: 'change-width',
    label: 'Change Width',
    icon: '\u2194',
    children: [
      { id: 'width-0.15', label: '0.15mm (6 mil)' },
      { id: 'width-0.2', label: '0.20mm (8 mil)' },
      { id: 'width-0.25', label: '0.25mm (10 mil)' },
      { id: 'width-0.3', label: '0.30mm (12 mil)' },
      { id: 'width-0.5', label: '0.50mm (20 mil)' },
      { id: 'width-1.0', label: '1.00mm (40 mil)' },
    ],
  },
  { id: 'change-layer', label: 'Change Layer', icon: '\u2261', children: [
    { id: 'layer-f.cu', label: 'F.Cu' },
    { id: 'layer-b.cu', label: 'B.Cu' },
    { id: 'layer-in1.cu', label: 'In1.Cu' },
    { id: 'layer-in2.cu', label: 'In2.Cu' },
  ]},
  { id: 'separator-2', label: '', separator: true },
  { id: 'select-net', label: 'Select Entire Net', icon: '\u26A1', shortcut: 'Ctrl+Click' },
];

const EMPTY_ITEMS: ContextMenuItem[] = [
  { id: 'paste', label: 'Paste', icon: '\u2398', shortcut: 'Ctrl+V' },
  { id: 'separator-1', label: '', separator: true },
  { id: 'place-component', label: 'Place Component', icon: '\u25A3', shortcut: 'C' },
  { id: 'add-wire', label: 'Add Wire / Trace', icon: '\u2500', shortcut: 'W' },
  { id: 'add-zone', label: 'Add Zone', icon: '\u25AD', shortcut: 'Z' },
  { id: 'add-via', label: 'Add Via', icon: '\u25C9', shortcut: 'X' },
  { id: 'separator-2', label: '', separator: true },
  { id: 'select-all', label: 'Select All', icon: '\u25A0', shortcut: 'Ctrl+A' },
  { id: 'zoom-fit', label: 'Zoom to Fit', icon: '\u26F6', shortcut: 'Ctrl+0' },
];

const PAD_ITEMS: ContextMenuItem[] = [
  { id: 'route-from', label: 'Route from Here', icon: '\u2192', shortcut: 'X' },
  { id: 'show-net', label: 'Show Net', icon: '\u26A1' },
  { id: 'highlight-net', label: 'Highlight Net', icon: '\u2606' },
  { id: 'separator-1', label: '', separator: true },
  { id: 'properties', label: 'Pad Properties', icon: '\u2699', shortcut: 'E' },
];

function getMenuItems(target: ContextTarget): ContextMenuItem[] {
  switch (target) {
    case 'component': return COMPONENT_ITEMS;
    case 'wire':
    case 'trace': return WIRE_TRACE_ITEMS;
    case 'pad': return PAD_ITEMS;
    case 'via': return PAD_ITEMS.filter(i => i.id !== 'route-from');
    case 'zone': return [
      { id: 'edit-zone', label: 'Edit Zone', icon: '\u2699', shortcut: 'E' },
      { id: 'refill-zone', label: 'Refill Zone', icon: '\u25A0' },
      { id: 'separator-1', label: '', separator: true },
      { id: 'delete', label: 'Delete Zone', icon: '\u2716', shortcut: 'Del', danger: true },
    ];
    case 'empty':
    default: return EMPTY_ITEMS;
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  backdrop: {
    position: 'fixed' as const,
    inset: 0,
    zIndex: 1500,
  },
  menu: {
    position: 'fixed' as const,
    zIndex: 1501,
    minWidth: 210,
    background: theme.bg1,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusMd,
    boxShadow: theme.shadowLg,
    padding: '4px 0',
    fontFamily: theme.fontSans,
    fontSize: theme.fontSm,
    userSelect: 'none' as const,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 12px',
    cursor: 'pointer',
    transition: 'background 0.1s ease',
    color: theme.textPrimary,
    position: 'relative' as const,
  },
  itemHover: {
    background: theme.blueDim,
    color: theme.blueHover,
  },
  itemDisabled: {
    color: theme.textMuted,
    cursor: 'default',
    pointerEvents: 'none' as const,
  },
  itemDanger: {
    color: theme.red,
  },
  icon: {
    width: 16,
    textAlign: 'center' as const,
    flexShrink: 0,
    fontSize: '12px',
    color: theme.textMuted,
  },
  label: {
    flex: 1,
  },
  shortcut: {
    fontFamily: theme.fontMono,
    fontSize: '9px',
    color: theme.textMuted,
    marginLeft: 'auto',
    paddingLeft: '16px',
  },
  arrow: {
    fontSize: '10px',
    color: theme.textMuted,
    marginLeft: '4px',
  },
  separator: {
    height: 1,
    background: theme.bg3,
    margin: '4px 0',
  },
  submenu: {
    position: 'absolute' as const,
    left: '100%',
    top: '-4px',
    minWidth: 170,
    background: theme.bg1,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusMd,
    boxShadow: theme.shadowLg,
    padding: '4px 0',
    zIndex: 1502,
  },
};

// ─── Submenu Component ──────────────────────────────────────────────────────

const SubMenu: React.FC<{
  items: ContextMenuItem[];
  onAction: (id: string) => void;
}> = ({ items, onAction }) => {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div style={styles.submenu}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            ...styles.item,
            ...(hovered === item.id ? styles.itemHover : {}),
          }}
          onMouseEnter={() => setHovered(item.id)}
          onMouseLeave={() => setHovered(null)}
          onClick={(e) => {
            e.stopPropagation();
            onAction(item.id);
          }}
        >
          <span style={styles.label}>{item.label}</span>
        </div>
      ))}
    </div>
  );
};

// ─── ContextMenu Component ──────────────────────────────────────────────────

const ContextMenu: React.FC<ContextMenuProps> = ({
  x,
  y,
  target,
  targetId,
  onAction,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x, y });

  const items = getMenuItems(target);

  // Adjust position so menu doesn't overflow viewport
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw - 8) nx = vw - rect.width - 8;
    if (y + rect.height > vh - 8) ny = vh - rect.height - 8;
    if (nx < 4) nx = 4;
    if (ny < 4) ny = 4;
    setMenuPos({ x: nx, y: ny });
  }, [x, y]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleAction = useCallback(
    (actionId: string) => {
      onAction(actionId, targetId);
      onClose();
    },
    [onAction, onClose, targetId]
  );

  return (
    <>
      {/* Invisible backdrop to capture clicks outside */}
      <div style={styles.backdrop} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />

      <div ref={menuRef} style={{ ...styles.menu, left: menuPos.x, top: menuPos.y }}>
        {items.map((item) => {
          if (item.separator) {
            return <div key={item.id} style={styles.separator} />;
          }

          const isHovered = hoveredId === item.id;
          const hasChildren = item.children && item.children.length > 0;

          return (
            <div
              key={item.id}
              style={{
                ...styles.item,
                ...(isHovered ? styles.itemHover : {}),
                ...(item.disabled ? styles.itemDisabled : {}),
                ...(item.danger && !isHovered ? styles.itemDanger : {}),
              }}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => {
                if (item.disabled || hasChildren) return;
                handleAction(item.id);
              }}
            >
              <span style={{
                ...styles.icon,
                ...(isHovered ? { color: item.danger ? theme.red : theme.blueHover } : {}),
                ...(item.danger && !isHovered ? { color: theme.red } : {}),
              }}>
                {item.icon || ''}
              </span>
              <span style={styles.label}>{item.label}</span>
              {item.shortcut && !hasChildren && (
                <span style={styles.shortcut}>{item.shortcut}</span>
              )}
              {hasChildren && (
                <span style={styles.arrow}>{'\u25B6'}</span>
              )}
              {hasChildren && isHovered && (
                <SubMenu items={item.children!} onAction={handleAction} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};

export default ContextMenu;
