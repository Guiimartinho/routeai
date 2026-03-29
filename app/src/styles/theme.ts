// ─── Professional Dark Theme ─────────────────────────────────────────────────

export const theme = {
  // Background levels (darkest to lightest)
  bg0: '#0d0f12',
  bg1: '#141720',
  bg2: '#1a1e2a',
  bg3: '#222839',

  // Text
  textPrimary: '#e8ecf4',
  textSecondary: '#9ba4b8',
  textMuted: '#5c6478',

  // Accent palette
  blue: '#4d9eff',
  blueHover: '#6bb0ff',
  blueDim: '#1d3a5c',
  green: '#3cdc7c',
  greenDim: '#1a3d2a',
  red: '#f05060',
  redDim: '#3d1a1e',
  orange: '#f0a030',
  orangeDim: '#3d2e14',
  purple: '#a06dff',
  purpleDim: '#2a1d4a',
  cyan: '#40d0e0',
  yellow: '#e0d040',

  // Layer colors (PCB)
  layers: {
    'F.Cu': '#f04040',
    'B.Cu': '#4060f0',
    'In1.Cu': '#40c040',
    'In2.Cu': '#c0c040',
    'In3.Cu': '#c040c0',
    'In4.Cu': '#40c0c0',
    'F.SilkS': '#f0f040',
    'B.SilkS': '#a040f0',
    'F.Mask': '#a04060',
    'B.Mask': '#4060a0',
    'F.Paste': '#c08080',
    'B.Paste': '#8080c0',
    'F.Fab': '#808040',
    'B.Fab': '#408080',
    'Edge.Cuts': '#e0e040',
    'Dwgs.User': '#808080',
    'Cmts.User': '#606060',
  } as Record<string, string>,

  // Grid
  gridColor: '#1e2434',
  gridDotColor: '#2a3048',
  gridMajorColor: '#2e3650',

  // Selection / interaction
  selectionColor: '#4d9eff',
  selectionFill: 'rgba(77,158,255,0.10)',
  hoverColor: '#6bb0ff',
  highlightColor: '#f0a030',

  // Schematic colors
  schWire: '#40c060',
  schBus: '#4d9eff',
  schJunction: '#40c060',
  schNoConnect: '#f05060',
  schBackground: '#0d0f12',
  schGrid: '#1a1e2a',
  schComponentBody: '#2a3048',
  schComponentBorder: '#9ba4b8',
  schPinColor: '#40c060',
  schPinName: '#9ba4b8',
  schRefColor: '#e8ecf4',
  schValueColor: '#9ba4b8',

  // Board colors
  brdBackground: '#0a0c10',
  brdGrid: '#161a24',
  brdRatsnest: '#505870',
  brdCourtyard: '#808080',

  // Font sizes
  fontXs: '10px',
  fontSm: '11px',
  fontMd: '13px',
  fontLg: '15px',
  fontXl: '18px',
  fontXxl: '22px',

  // Font families
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontSans: "'Inter', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",

  // Spacing
  sp1: '4px',
  sp2: '8px',
  sp3: '12px',
  sp4: '16px',
  sp5: '20px',
  sp6: '24px',
  sp8: '32px',

  // Border radius
  radiusSm: '3px',
  radiusMd: '6px',
  radiusLg: '10px',
  radiusFull: '9999px',

  // Borders
  border: '1px solid #222839',
  borderLight: '1px solid #2a3048',
  borderFocus: '1px solid #4d9eff',

  // Shadows
  shadow: '0 2px 8px rgba(0,0,0,0.3)',
  shadowLg: '0 4px 20px rgba(0,0,0,0.5)',

  // Toolbar / panel dimensions
  toolbarHeight: '38px',
  sidebarWidth: '240px',
  panelMinWidth: '200px',
  statusBarHeight: '24px',
} as const;

export type Theme = typeof theme;
export default theme;
