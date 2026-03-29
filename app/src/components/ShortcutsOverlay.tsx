// ─── ShortcutsOverlay.tsx ─ Keyboard shortcuts help modal ───────────────────
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { theme } from '../styles/theme';

// ─── Shortcut data ──────────────────────────────────────────────────────────

interface Shortcut {
  keys: string;
  description: string;
}

interface ShortcutCategory {
  name: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    name: 'Tools',
    shortcuts: [
      { keys: 'V', description: 'Select tool' },
      { keys: 'W', description: 'Wire tool' },
      { keys: 'C', description: 'Place Component' },
      { keys: 'L', description: 'Place Label' },
      { keys: 'P', description: 'Place Power symbol' },
      { keys: 'B', description: 'Bus tool' },
      { keys: 'M', description: 'Measure tool' },
    ],
  },
  {
    name: 'Editing',
    shortcuts: [
      { keys: 'Ctrl+Z', description: 'Undo' },
      { keys: 'Ctrl+Y', description: 'Redo' },
      { keys: 'Del', description: 'Delete selected' },
      { keys: 'R', description: 'Rotate selected' },
      { keys: 'F', description: 'Flip selected' },
      { keys: 'Ctrl+C', description: 'Copy' },
      { keys: 'Ctrl+V', description: 'Paste' },
      { keys: 'Ctrl+X', description: 'Cut' },
    ],
  },
  {
    name: 'File',
    shortcuts: [
      { keys: 'Ctrl+N', description: 'New Project' },
      { keys: 'Ctrl+O', description: 'Open Project' },
      { keys: 'Ctrl+S', description: 'Save to Browser' },
      { keys: 'Ctrl+Shift+S', description: 'Save as File' },
    ],
  },
  {
    name: 'View',
    shortcuts: [
      { keys: 'Scroll', description: 'Zoom in/out' },
      { keys: 'Middle-drag', description: 'Pan canvas' },
      { keys: 'H', description: 'Fit to screen' },
      { keys: '?', description: 'Show this help' },
    ],
  },
  {
    name: 'Board',
    shortcuts: [
      { keys: 'X', description: 'Route trace' },
      { keys: 'Z', description: 'Draw zone / copper pour' },
      { keys: 'V', description: 'Place via (during routing)' },
      { keys: 'Enter', description: 'Finish current route' },
      { keys: 'Esc', description: 'Cancel current action' },
    ],
  },
];

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.60)',
  backdropFilter: 'blur(4px)',
};

const modalStyle: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: theme.radiusLg,
  boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
  width: '600px',
  maxWidth: '92vw',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  fontFamily: theme.fontSans,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '16px 20px 12px',
  borderBottom: `1px solid ${theme.bg3}`,
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  fontSize: theme.fontLg,
  fontWeight: 700,
  color: theme.textPrimary,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: theme.textMuted,
  fontSize: '18px',
  cursor: 'pointer',
  padding: '4px 8px',
  borderRadius: theme.radiusSm,
  lineHeight: 1,
  transition: 'color 0.1s',
};

const searchWrapperStyle: React.CSSProperties = {
  padding: '12px 20px',
  borderBottom: `1px solid ${theme.bg3}`,
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: theme.fontSm,
  fontFamily: theme.fontSans,
  background: theme.bg0,
  border: `1px solid ${theme.bg3}`,
  borderRadius: theme.radiusMd,
  color: theme.textPrimary,
  outline: 'none',
  boxSizing: 'border-box',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '8px 20px 20px',
};

const categoryTitleStyle: React.CSSProperties = {
  fontSize: theme.fontXs,
  fontWeight: 600,
  color: theme.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.8px',
  marginTop: '16px',
  marginBottom: '8px',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '5px 8px',
  borderRadius: theme.radiusSm,
  transition: 'background 0.08s',
};

const descStyle: React.CSSProperties = {
  fontSize: theme.fontSm,
  color: theme.textSecondary,
};

const kbdContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '4px',
  flexShrink: 0,
};

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 7px',
  fontSize: '10px',
  fontFamily: theme.fontMono,
  fontWeight: 600,
  color: theme.textPrimary,
  background: theme.bg3,
  border: `1px solid ${theme.textMuted}`,
  borderBottom: `2px solid ${theme.textMuted}`,
  borderRadius: '4px',
  lineHeight: '16px',
  whiteSpace: 'nowrap',
};

const footerStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderTop: `1px solid ${theme.bg3}`,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexShrink: 0,
};

const footerTextStyle: React.CSSProperties = {
  fontSize: theme.fontXs,
  color: theme.textMuted,
};

// ─── Key badge renderer ─────────────────────────────────────────────────────

function KeyBadge({ keys }: { keys: string }) {
  // Split compound shortcuts like "Ctrl+Shift+S" into individual badges
  const parts = keys.split('+');
  return (
    <span style={kbdContainerStyle}>
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <span style={kbdStyle}>{part}</span>
          {i < parts.length - 1 && (
            <span style={{ color: theme.textMuted, fontSize: '10px', alignSelf: 'center' }}>+</span>
          )}
        </React.Fragment>
      ))}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

const ShortcutsOverlay: React.FC<ShortcutsOverlayProps> = ({ open, onClose }) => {
  const [filter, setFilter] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setFilter('');
      // Small delay to ensure modal is rendered
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  // Close on click outside modal
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }, [onClose]);

  if (!open) return null;

  // Filter categories and shortcuts
  const query = filter.toLowerCase().trim();
  const filteredCategories = SHORTCUT_CATEGORIES.map((cat) => {
    if (!query) return cat;
    const filtered = cat.shortcuts.filter(
      (s) =>
        s.description.toLowerCase().includes(query) ||
        s.keys.toLowerCase().includes(query) ||
        cat.name.toLowerCase().includes(query)
    );
    return { ...cat, shortcuts: filtered };
  }).filter((cat) => cat.shortcuts.length > 0);

  return (
    <div ref={overlayRef} style={overlayStyle} onClick={handleOverlayClick}>
      <div style={modalStyle} role="dialog" aria-label="Keyboard Shortcuts">
        {/* Header */}
        <div style={headerStyle}>
          <span style={titleStyle}>Keyboard Shortcuts</span>
          <button
            style={closeBtnStyle}
            onClick={onClose}
            title="Close (Esc)"
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = theme.textPrimary; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = theme.textMuted; }}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Search */}
        <div style={searchWrapperStyle}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search shortcuts..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={searchInputStyle}
            onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = theme.blue; }}
            onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = theme.bg3; }}
          />
        </div>

        {/* Body */}
        <div style={bodyStyle}>
          {filteredCategories.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: theme.textMuted, fontSize: theme.fontSm }}>
              No shortcuts match "{filter}"
            </div>
          )}
          {filteredCategories.map((cat) => (
            <div key={cat.name}>
              <div style={categoryTitleStyle}>{cat.name}</div>
              {cat.shortcuts.map((s, i) => (
                <div
                  key={i}
                  style={rowStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg2; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={descStyle}>{s.description}</span>
                  <KeyBadge keys={s.keys} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <span style={footerTextStyle}>
            Press <span style={kbdStyle}>?</span> or <span style={kbdStyle}>F1</span> to toggle this overlay
          </span>
          <span style={footerTextStyle}>
            <span style={kbdStyle}>Esc</span> to close
          </span>
        </div>
      </div>
    </div>
  );
};

export default ShortcutsOverlay;
