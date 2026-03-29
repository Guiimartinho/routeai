import React, { useRef, useState, useEffect, useCallback } from 'react';
import { theme } from '../styles/theme';
import { getRecentProjects, clearRecentProjects, type StoredRecentProject } from '../store/recentProjects';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
}

export interface WelcomeScreenProps {
  recentProjects: RecentProject[];
  onNewProject: () => void;
  onOpenFile: (file: File) => void;
  onOpenRecent: (path: string) => void;
  onLoadExample: (exampleId: string) => void;
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: `radial-gradient(ellipse at 50% 40%, ${theme.bg2} 0%, ${theme.bg0} 70%)`,
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    overflow: 'auto',
  },
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '32px',
    padding: '40px',
    maxWidth: 680,
    width: '100%',
  },
  logo: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
    userSelect: 'none' as const,
  },
  logoIcon: {
    width: 64,
    height: 64,
    borderRadius: '16px',
    background: `linear-gradient(135deg, ${theme.blue} 0%, ${theme.purple} 100%)`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '28px',
    color: '#fff',
    fontWeight: 700,
    boxShadow: `0 4px 24px rgba(77,158,255,0.3)`,
  },
  logoName: {
    fontSize: theme.fontXxl,
    fontWeight: 700,
    letterSpacing: '-0.5px',
    background: `linear-gradient(135deg, ${theme.blue} 0%, ${theme.purple} 100%)`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  logoSubtitle: {
    fontSize: theme.fontSm,
    color: theme.textMuted,
    textAlign: 'center' as const,
  },
  actions: {
    display: 'flex',
    gap: '12px',
    width: '100%',
    maxWidth: 400,
  },
  actionBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '8px',
    padding: '20px 16px',
    background: theme.bg2,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusLg,
    cursor: 'pointer',
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    transition: 'all 0.15s ease',
  },
  actionBtnHover: {
    borderColor: theme.blue,
    background: theme.bg3,
    boxShadow: `0 0 0 1px ${theme.blue}, 0 4px 16px rgba(0,0,0,0.3)`,
  },
  actionIcon: {
    fontSize: '24px',
    lineHeight: 1,
  },
  actionLabel: {
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  actionDesc: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    textAlign: 'center' as const,
  },
  section: {
    width: '100%',
    maxWidth: 500,
  },
  sectionTitle: {
    fontSize: theme.fontSm,
    fontWeight: 600,
    color: theme.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
    marginBottom: '10px',
  },
  recentList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  recentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 12px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: 'all 0.1s ease',
    border: 'none',
    background: 'transparent',
    fontFamily: theme.fontSans,
    color: theme.textPrimary,
    fontSize: theme.fontSm,
    width: '100%',
    textAlign: 'left' as const,
  },
  recentItemHover: {
    background: theme.bg2,
  },
  recentIcon: {
    color: theme.textMuted,
    fontSize: '14px',
    flexShrink: 0,
  },
  recentName: {
    flex: 1,
    fontWeight: 500,
  },
  recentPath: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: 200,
  },
  recentDate: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    flexShrink: 0,
  },
  exampleCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    background: theme.bg2,
    border: `1px solid ${theme.bg3}`,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  exampleCardHover: {
    borderColor: theme.blue,
    background: theme.bg3,
  },
  exampleIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radiusMd,
    background: theme.bg3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    flexShrink: 0,
  },
  exampleContent: {
    flex: 1,
  },
  exampleName: {
    fontSize: theme.fontMd,
    fontWeight: 600,
  },
  exampleDesc: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    marginTop: '2px',
  },
  features: {
    display: 'flex',
    gap: '24px',
    justifyContent: 'center',
    flexWrap: 'wrap' as const,
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: theme.fontXs,
    color: theme.textMuted,
  },
  featureIcon: {
    fontSize: '12px',
  },
  version: {
    fontSize: theme.fontXs,
    color: theme.textMuted,
    opacity: 0.5,
    marginTop: '8px',
  },
};

// ─── Helper ─────────────────────────────────────────────────────────────────

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

// ─── Hover Button Wrapper ───────────────────────────────────────────────────

const HoverDiv: React.FC<{
  baseStyle: React.CSSProperties;
  hoverStyle: React.CSSProperties;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ baseStyle, hoverStyle, onClick, children }) => {
  const [hovered, setHovered] = React.useState(false);
  return (
    <div
      style={{ ...baseStyle, ...(hovered ? hoverStyle : {}) }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

// ─── Example projects ───────────────────────────────────────────────────────

const EXAMPLES = [
  {
    id: 'stm32-devboard',
    name: 'STM32 Dev Board',
    description: 'STM32F407 development board with USB, UART, SPI, and power regulation.',
    icon: '\u2339',
  },
  {
    id: 'esp32-sensor',
    name: 'ESP32 Sensor Node',
    description: 'Wireless sensor node with temperature, humidity, and battery management.',
    icon: '\u2637',
  },
  {
    id: 'usb-pd',
    name: 'USB-PD Sink Board',
    description: 'USB Power Delivery sink with STUSB4500 for 5-20V negotiation.',
    icon: '\u26A1',
  },
];

// ─── WelcomeScreen Component ────────────────────────────────────────────────

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
  recentProjects,
  onNewProject,
  onOpenFile,
  onOpenRecent,
  onLoadExample,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [storedRecent, setStoredRecent] = useState<StoredRecentProject[]>([]);

  // Load recent projects from localStorage on mount
  useEffect(() => {
    setStoredRecent(getRecentProjects());
  }, []);

  const handleClearRecent = useCallback(() => {
    clearRecentProjects();
    setStoredRecent([]);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onOpenFile(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Merge prop-based recent projects with localStorage-based ones
  const allRecent = storedRecent.length > 0 ? storedRecent : [];

  return (
    <div style={styles.root}>
      <div style={styles.container}>
        {/* Logo */}
        <div style={styles.logo}>
          <div style={styles.logoIcon}>{'\u2B22'}</div>
          <span style={styles.logoName as React.CSSProperties}>RouteAI EDA</span>
          <span style={styles.logoSubtitle}>
            AI-powered PCB design editor with local LLM integration
          </span>
        </div>

        {/* Primary actions */}
        <div style={styles.actions}>
          <HoverDiv
            baseStyle={styles.actionBtn}
            hoverStyle={styles.actionBtnHover}
            onClick={onNewProject}
          >
            <span style={styles.actionIcon}>{'\u2B22'}</span>
            <span style={styles.actionLabel}>New Project</span>
            <span style={styles.actionDesc}>Start a new PCB design from scratch</span>
          </HoverDiv>

          <HoverDiv
            baseStyle={styles.actionBtn}
            hoverStyle={styles.actionBtnHover}
            onClick={() => fileRef.current?.click()}
          >
            <span style={styles.actionIcon}>{'\u2191'}</span>
            <span style={styles.actionLabel}>Open KiCad Project</span>
            <span style={styles.actionDesc}>Import .kicad_pro, .kicad_sch, .kicad_pcb</span>
          </HoverDiv>

          <input
            ref={fileRef}
            type="file"
            accept=".kicad_pro,.kicad_sch,.kicad_pcb,.sch,.brd,.zip,.json,.routeai.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        {/* Recent projects from props */}
        {recentProjects.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Recent Projects</div>
            <div style={styles.recentList}>
              {recentProjects.slice(0, 5).map((p) => (
                <HoverDiv
                  key={p.path}
                  baseStyle={styles.recentItem}
                  hoverStyle={styles.recentItemHover}
                  onClick={() => onOpenRecent(p.path)}
                >
                  <span style={styles.recentIcon}>{'\u25A3'}</span>
                  <span style={styles.recentName}>{p.name}</span>
                  <span style={styles.recentPath}>{p.path}</span>
                  <span style={styles.recentDate}>{formatDate(p.lastOpened)}</span>
                </HoverDiv>
              ))}
            </div>
          </div>
        )}

        {/* Recent projects from localStorage */}
        {allRecent.length > 0 && recentProjects.length === 0 && (
          <div style={styles.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={styles.sectionTitle}>Recent Projects</div>
              <button
                onClick={handleClearRecent}
                style={{
                  background: 'none',
                  border: `1px solid ${theme.bg3}`,
                  borderRadius: theme.radiusSm,
                  color: theme.textMuted,
                  fontSize: theme.fontXs,
                  fontFamily: theme.fontSans,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.color = theme.red;
                  (e.currentTarget as HTMLElement).style.borderColor = theme.red;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.color = theme.textMuted;
                  (e.currentTarget as HTMLElement).style.borderColor = theme.bg3;
                }}
              >
                Clear Recent
              </button>
            </div>
            <div style={styles.recentList}>
              {allRecent.slice(0, 5).map((p, idx) => (
                <HoverDiv
                  key={p.name + '-' + idx}
                  baseStyle={styles.recentItem}
                  hoverStyle={styles.recentItemHover}
                  onClick={() => onOpenRecent(p.name)}
                >
                  <span style={styles.recentIcon}>{'\u25A3'}</span>
                  <span style={styles.recentName}>{p.name}</span>
                  <span style={{
                    fontSize: theme.fontXs,
                    color: theme.textMuted,
                    fontFamily: theme.fontMono,
                    whiteSpace: 'nowrap',
                  }}>
                    {p.componentCount} comp{p.componentCount !== 1 ? 's' : ''} / {p.netCount} net{p.netCount !== 1 ? 's' : ''}
                  </span>
                  <span style={styles.recentDate}>{formatDate(p.date)}</span>
                </HoverDiv>
              ))}
            </div>
          </div>
        )}

        {/* Example projects */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Example Projects</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {EXAMPLES.map((ex) => (
              <HoverDiv
                key={ex.id}
                baseStyle={styles.exampleCard}
                hoverStyle={styles.exampleCardHover}
                onClick={() => onLoadExample(ex.id)}
              >
                <div style={styles.exampleIcon}>{ex.icon}</div>
                <div style={styles.exampleContent}>
                  <div style={styles.exampleName}>{ex.name}</div>
                  <div style={styles.exampleDesc}>{ex.description}</div>
                </div>
                <span style={{ color: theme.textMuted, fontSize: '12px' }}>{'\u2192'}</span>
              </HoverDiv>
            ))}
          </div>
        </div>

        {/* Feature highlights */}
        <div style={styles.features}>
          <span style={styles.feature}>
            <span style={{ ...styles.featureIcon, color: theme.purple }}>{'\u2728'}</span>
            AI-Powered Design Review
          </span>
          <span style={styles.feature}>
            <span style={{ ...styles.featureIcon, color: theme.green }}>{'\u2699'}</span>
            Local LLM (Ollama)
          </span>
          <span style={styles.feature}>
            <span style={{ ...styles.featureIcon, color: theme.blue }}>{'\u221E'}</span>
            100% Free &amp; Open
          </span>
        </div>

        <span style={styles.version}>RouteAI EDA v0.1.0</span>
      </div>
    </div>
  );
};

export default WelcomeScreen;
