// ─── SettingsDialog.tsx ── Modal settings/preferences dialog ─────────────────
import React, { useState, useEffect, useCallback } from 'react';
import { theme } from '../styles/theme';
import { useEditorStore } from '../store/editorStore';

// ─── Types ───────────────────────────────────────────────────────────────────

type SettingsTab = 'general' | 'grid' | 'defaults' | 'theme' | 'ollama';

type AutoSaveInterval = 10000 | 30000 | 60000 | 0;
type Units = 'mm' | 'mil' | 'inch';
type GridSize = 0.1 | 0.5 | 1.0 | 2.54;
type SnapAngle = 45 | 90 | 0;
type CopperWeight = '0.5oz' | '1oz' | '2oz';
type ThemeMode = 'dark' | 'light';

export interface RouteAISettings {
  // General
  autoSaveInterval: AutoSaveInterval;
  language: string;
  units: Units;

  // Grid & Snap
  gridSize: GridSize;
  snapToGrid: boolean;
  snapAngle: SnapAngle;

  // Defaults
  defaultTraceWidth: number;
  defaultViaDrill: number;
  defaultViaSize: number;
  defaultCopperWeight: CopperWeight;

  // Theme
  themeMode: ThemeMode;

  // Ollama
  ollamaUrl: string;
  ollamaModel: string;
  aiEnabled: boolean;
}

const DEFAULT_SETTINGS: RouteAISettings = {
  autoSaveInterval: 30000,
  language: 'en',
  units: 'mm',
  gridSize: 2.54,
  snapToGrid: true,
  snapAngle: 45,
  defaultTraceWidth: 0.25,
  defaultViaDrill: 0.3,
  defaultViaSize: 0.6,
  defaultCopperWeight: '1oz',
  themeMode: 'dark',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5-coder:14b',
  aiEnabled: true,
};

const STORAGE_KEY = 'routeai_settings';

export function loadSettings(): RouteAISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings: RouteAISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 5000,
};

const dialogStyle: React.CSSProperties = {
  background: theme.bg1,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '10px',
  boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
  width: '620px',
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: theme.fontSans,
  color: theme.textPrimary,
  overflow: 'hidden',
};

const sidebarTabStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  fontSize: '12px',
  fontWeight: active ? 600 : 400,
  color: active ? theme.blue : theme.textSecondary,
  background: active ? theme.bg2 : 'transparent',
  border: 'none',
  borderLeft: active ? `2px solid ${theme.blue}` : '2px solid transparent',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: theme.fontSans,
  transition: 'all 0.12s',
  width: '100%',
});

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: theme.textSecondary,
  marginBottom: '4px',
  display: 'block',
};

const selectStyle: React.CSSProperties = {
  background: theme.bg3,
  color: theme.textPrimary,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  padding: '5px 8px',
  fontSize: '12px',
  fontFamily: theme.fontSans,
  width: '100%',
  outline: 'none',
};

const inputStyle: React.CSSProperties = {
  ...selectStyle,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 0',
  borderBottom: `1px solid ${theme.bg3}`,
};

const sectionTitle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: theme.textPrimary,
  marginBottom: '12px',
  marginTop: '4px',
};

const toggleTrack = (on: boolean): React.CSSProperties => ({
  width: '36px',
  height: '20px',
  borderRadius: '10px',
  background: on ? theme.blue : theme.bg3,
  border: `1px solid ${on ? theme.blue : theme.textMuted}`,
  position: 'relative',
  cursor: 'pointer',
  transition: 'all 0.15s',
  flexShrink: 0,
});

const toggleKnob = (on: boolean): React.CSSProperties => ({
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  background: on ? '#fff' : theme.textMuted,
  position: 'absolute',
  top: '2px',
  left: on ? '18px' : '2px',
  transition: 'all 0.15s',
});

// ─── Sub-components ──────────────────────────────────────────────────────────

const Toggle: React.FC<{ value: boolean; onChange: (v: boolean) => void }> = ({ value, onChange }) => (
  <div style={toggleTrack(value)} onClick={() => onChange(!value)}>
    <div style={toggleKnob(value)} />
  </div>
);

const FieldRow: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div style={rowStyle}>
    <div style={{ flex: 1, marginRight: '16px' }}>
      <span style={{ fontSize: '12px', color: theme.textPrimary }}>{label}</span>
      {hint && <div style={{ fontSize: '10px', color: theme.textMuted, marginTop: '2px' }}>{hint}</div>}
    </div>
    <div style={{ minWidth: '160px', display: 'flex', justifyContent: 'flex-end' }}>
      {children}
    </div>
  </div>
);

// ─── Tab panels ──────────────────────────────────────────────────────────────

const GeneralTab: React.FC<{
  settings: RouteAISettings;
  onChange: (patch: Partial<RouteAISettings>) => void;
}> = ({ settings, onChange }) => (
  <div>
    <div style={sectionTitle}>General Settings</div>

    <FieldRow label="Auto-save interval" hint="How often to save to browser storage">
      <select
        style={selectStyle}
        value={settings.autoSaveInterval}
        onChange={(e) => onChange({ autoSaveInterval: Number(e.target.value) as AutoSaveInterval })}
      >
        <option value={10000}>Every 10 seconds</option>
        <option value={30000}>Every 30 seconds</option>
        <option value={60000}>Every 60 seconds</option>
        <option value={0}>Off</option>
      </select>
    </FieldRow>

    <FieldRow label="Language">
      <select style={selectStyle} value={settings.language} disabled>
        <option value="en">English</option>
      </select>
    </FieldRow>

    <FieldRow label="Units" hint="Default measurement unit for display">
      <select
        style={selectStyle}
        value={settings.units}
        onChange={(e) => onChange({ units: e.target.value as Units })}
      >
        <option value="mm">Millimeters (mm)</option>
        <option value="mil">Mils (thou)</option>
        <option value="inch">Inches</option>
      </select>
    </FieldRow>
  </div>
);

const GridSnapTab: React.FC<{
  settings: RouteAISettings;
  onChange: (patch: Partial<RouteAISettings>) => void;
}> = ({ settings, onChange }) => (
  <div>
    <div style={sectionTitle}>Grid &amp; Snap Settings</div>

    <FieldRow label="Grid size" hint="Spacing between grid points">
      <select
        style={selectStyle}
        value={settings.gridSize}
        onChange={(e) => onChange({ gridSize: Number(e.target.value) as GridSize })}
      >
        <option value={0.1}>0.1 mm (fine)</option>
        <option value={0.5}>0.5 mm</option>
        <option value={1.0}>1.0 mm</option>
        <option value={2.54}>2.54 mm (100 mil)</option>
      </select>
    </FieldRow>

    <FieldRow label="Snap to grid" hint="Snap cursor and objects to grid points">
      <Toggle value={settings.snapToGrid} onChange={(v) => onChange({ snapToGrid: v })} />
    </FieldRow>

    <FieldRow label="Snap angle" hint="Constrain wire angles">
      <select
        style={selectStyle}
        value={settings.snapAngle}
        onChange={(e) => onChange({ snapAngle: Number(e.target.value) as SnapAngle })}
      >
        <option value={45}>45 degrees</option>
        <option value={90}>90 degrees</option>
        <option value={0}>Free angle</option>
      </select>
    </FieldRow>
  </div>
);

const DefaultsTab: React.FC<{
  settings: RouteAISettings;
  onChange: (patch: Partial<RouteAISettings>) => void;
}> = ({ settings, onChange }) => (
  <div>
    <div style={sectionTitle}>Default Values</div>

    <FieldRow label="Default trace width" hint="mm">
      <input
        type="number"
        step={0.01}
        min={0.05}
        max={10}
        style={inputStyle}
        value={settings.defaultTraceWidth}
        onChange={(e) => onChange({ defaultTraceWidth: parseFloat(e.target.value) || 0.25 })}
      />
    </FieldRow>

    <FieldRow label="Default via drill" hint="mm">
      <input
        type="number"
        step={0.01}
        min={0.1}
        max={5}
        style={inputStyle}
        value={settings.defaultViaDrill}
        onChange={(e) => onChange({ defaultViaDrill: parseFloat(e.target.value) || 0.3 })}
      />
    </FieldRow>

    <FieldRow label="Default via size" hint="mm (outer diameter)">
      <input
        type="number"
        step={0.01}
        min={0.2}
        max={10}
        style={inputStyle}
        value={settings.defaultViaSize}
        onChange={(e) => onChange({ defaultViaSize: parseFloat(e.target.value) || 0.6 })}
      />
    </FieldRow>

    <FieldRow label="Default copper weight">
      <select
        style={selectStyle}
        value={settings.defaultCopperWeight}
        onChange={(e) => onChange({ defaultCopperWeight: e.target.value as CopperWeight })}
      >
        <option value="0.5oz">0.5 oz (17 um)</option>
        <option value="1oz">1 oz (35 um)</option>
        <option value="2oz">2 oz (70 um)</option>
      </select>
    </FieldRow>
  </div>
);

const ThemeTab: React.FC<{
  settings: RouteAISettings;
  onChange: (patch: Partial<RouteAISettings>) => void;
}> = ({ settings }) => (
  <div>
    <div style={sectionTitle}>Theme</div>

    <FieldRow label="Dark mode">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 600,
            background: theme.blue,
            color: '#fff',
            cursor: 'default',
          }}
        >
          Dark
        </div>
        <div
          style={{
            padding: '6px 14px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 400,
            background: theme.bg3,
            color: theme.textMuted,
            cursor: 'not-allowed',
            opacity: 0.5,
          }}
          title="Light theme coming soon"
        >
          Light
        </div>
      </div>
    </FieldRow>

    <div style={{
      marginTop: '16px',
      padding: '12px',
      background: theme.bg2,
      borderRadius: '6px',
      fontSize: '11px',
      color: theme.textMuted,
      lineHeight: 1.5,
    }}>
      Light theme is under development and will be available in a future release.
      The current dark theme is optimized for extended EDA sessions and reduces eye strain.
    </div>
  </div>
);

interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

interface OllamaConnectionStatus {
  connected: boolean;
  latencyMs: number | null;
  models: OllamaModel[];
  error: string | null;
}

// Use relative URLs so Vite proxy routes to Go backend
const BACKEND_API_URL = '';

const MODEL_RECOMMENDATIONS: Record<string, string> = {
  'qwen2.5-coder:14b': 'Best for PCB design tasks -- strong code understanding and structured output',
  'qwen2.5-coder:7b': 'Good balance of speed and quality for PCB tasks',
  'qwen2.5:14b': 'General-purpose, solid reasoning for design review',
  'qwen2.5:7b': 'Fast general-purpose model, acceptable for simple queries',
  'codellama:13b': 'Good code generation, less PCB domain knowledge',
  'llama3.2': 'Lightweight fallback, fast but less accurate for EDA tasks',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const OllamaTab: React.FC<{
  settings: RouteAISettings;
  onChange: (patch: Partial<RouteAISettings>) => void;
}> = ({ settings, onChange }) => {
  const [connStatus, setConnStatus] = useState<OllamaConnectionStatus>({
    connected: false, latencyMs: null, models: [], error: null,
  });
  const [testing, setTesting] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [pullModel, setPullModel] = useState('');
  const [pullProgress, setPullProgress] = useState('');

  const testConnection = useCallback(async () => {
    setTesting(true);
    setConnStatus(prev => ({ ...prev, error: null }));
    try {
      const start = performance.now();
      const res = await fetch(`${BACKEND_API_URL}/api/ollama/status`);
      const elapsed = performance.now() - start;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConnStatus({
        connected: data.connected,
        latencyMs: data.response_time_ms ?? Math.round(elapsed),
        models: data.models || [],
        error: data.connected ? null : (data.error || 'Cannot reach Ollama'),
      });
    } catch (err: any) {
      setConnStatus({
        connected: false,
        latencyMs: null,
        models: [],
        error: `Backend unreachable: ${err.message}`,
      });
    }
    setTesting(false);
  }, []);

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/ollama/models`);
      if (!res.ok) return;
      const data = await res.json();
      setConnStatus(prev => ({
        ...prev,
        connected: true,
        models: data.models || [],
        error: null,
      }));
    } catch {
      // silent
    }
  }, []);

  // Fetch models on mount
  useEffect(() => {
    if (settings.aiEnabled) {
      fetchModels();
    }
  }, [settings.aiEnabled, fetchModels]);

  const handlePull = useCallback(async () => {
    const model = pullModel.trim();
    if (!model) return;
    setPulling(true);
    setPullProgress('Starting download...');
    try {
      const res = await fetch(`${BACKEND_API_URL}/api/ollama/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        setPullProgress(`Error: ${err.detail || res.statusText}`);
        setPulling(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        setPullProgress('Error: no response body');
        setPulling(false);
        return;
      }
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.status) {
              const pct = parsed.completed && parsed.total
                ? ` (${Math.round((parsed.completed / parsed.total) * 100)}%)`
                : '';
              setPullProgress(`${parsed.status}${pct}`);
            }
          } catch {
            // skip
          }
        }
      }
      setPullProgress(`Done! ${model} is ready.`);
      // Refresh model list
      await fetchModels();
    } catch (err: any) {
      setPullProgress(`Error: ${err.message}`);
    }
    setPulling(false);
  }, [pullModel, fetchModels]);

  const loadedModel = connStatus.models.find(
    m => m.name === settings.ollamaModel || m.name.startsWith(settings.ollamaModel + ':'),
  );

  return (
    <div>
      <div style={sectionTitle}>Ollama / AI Configuration</div>

      <FieldRow label="Enable AI features" hint="Toggle AI design review, placement, and routing">
        <Toggle value={settings.aiEnabled} onChange={(v) => onChange({ aiEnabled: v })} />
      </FieldRow>

      <FieldRow label="Ollama URL" hint="Address of your Ollama instance">
        <input
          type="text"
          style={inputStyle}
          value={settings.ollamaUrl}
          onChange={(e) => onChange({ ollamaUrl: e.target.value })}
          placeholder="http://localhost:11434"
          disabled={!settings.aiEnabled}
        />
      </FieldRow>

      {/* Connection test */}
      <div style={{ ...rowStyle, flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: connStatus.connected ? theme.green : connStatus.error ? theme.red : theme.textMuted,
            }} />
            <span style={{ fontSize: '12px', color: theme.textPrimary }}>
              {connStatus.connected ? 'Connected' : connStatus.error ? 'Disconnected' : 'Not tested'}
            </span>
            {connStatus.latencyMs !== null && (
              <span style={{ fontSize: '10px', color: theme.textMuted, fontFamily: theme.fontMono }}>
                {connStatus.latencyMs}ms
              </span>
            )}
          </div>
          <button
            onClick={testConnection}
            disabled={!settings.aiEnabled || testing}
            style={{
              background: theme.bg3,
              border: `1px solid ${theme.blue}`,
              borderRadius: '4px',
              color: theme.blue,
              fontSize: '11px',
              fontFamily: theme.fontSans,
              padding: '4px 12px',
              cursor: settings.aiEnabled && !testing ? 'pointer' : 'not-allowed',
              opacity: settings.aiEnabled && !testing ? 1 : 0.5,
            }}
          >
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
        </div>
        {connStatus.error && (
          <div style={{ fontSize: '10px', color: theme.red }}>{connStatus.error}</div>
        )}
      </div>

      {/* Active model */}
      <FieldRow label="Active model" hint="Model used for AI features">
        {connStatus.models.length > 0 ? (
          <select
            style={selectStyle}
            value={settings.ollamaModel}
            onChange={(e) => onChange({ ollamaModel: e.target.value })}
            disabled={!settings.aiEnabled}
          >
            {connStatus.models.map(m => (
              <option key={m.name} value={m.name}>
                {m.name} ({formatBytes(m.size)})
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            style={inputStyle}
            value={settings.ollamaModel}
            onChange={(e) => onChange({ ollamaModel: e.target.value })}
            placeholder="qwen2.5-coder:14b"
            disabled={!settings.aiEnabled}
          />
        )}
      </FieldRow>

      {/* Model recommendation */}
      {settings.ollamaModel && MODEL_RECOMMENDATIONS[settings.ollamaModel] && (
        <div style={{
          padding: '8px 10px',
          background: `${theme.blue}15`,
          border: `1px solid ${theme.blue}30`,
          borderRadius: '4px',
          fontSize: '10px',
          color: theme.textSecondary,
          lineHeight: 1.4,
          marginTop: '4px',
        }}>
          {MODEL_RECOMMENDATIONS[settings.ollamaModel]}
        </div>
      )}

      {/* Available models list */}
      {connStatus.models.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '11px', color: theme.textMuted, marginBottom: '6px' }}>
            Available models ({connStatus.models.length}):
          </div>
          <div style={{
            maxHeight: '120px', overflowY: 'auto',
            background: theme.bg2, borderRadius: '4px', padding: '6px',
          }}>
            {connStatus.models.map(m => (
              <div
                key={m.name}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '3px 6px', borderRadius: '3px', cursor: 'pointer',
                  fontSize: '11px', fontFamily: theme.fontMono,
                  background: m.name === settings.ollamaModel ? `${theme.blue}20` : 'transparent',
                  color: m.name === settings.ollamaModel ? theme.blue : theme.textSecondary,
                }}
                onClick={() => settings.aiEnabled && onChange({ ollamaModel: m.name })}
              >
                <span>{m.name}</span>
                <span style={{ fontSize: '10px', color: theme.textMuted }}>{formatBytes(m.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pull model */}
      <div style={{
        marginTop: '12px', padding: '10px',
        background: theme.bg2, borderRadius: '6px',
      }}>
        <div style={{ fontSize: '11px', color: theme.textMuted, marginBottom: '6px' }}>
          Pull a new model:
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            type="text"
            style={{ ...inputStyle, flex: 1 }}
            value={pullModel}
            onChange={(e) => setPullModel(e.target.value)}
            placeholder="qwen2.5-coder:14b"
            disabled={!settings.aiEnabled || pulling}
          />
          <button
            onClick={handlePull}
            disabled={!settings.aiEnabled || pulling || !pullModel.trim()}
            style={{
              background: theme.blue,
              border: 'none',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '11px',
              fontFamily: theme.fontSans,
              fontWeight: 600,
              padding: '4px 12px',
              cursor: settings.aiEnabled && !pulling && pullModel.trim() ? 'pointer' : 'not-allowed',
              opacity: settings.aiEnabled && !pulling && pullModel.trim() ? 1 : 0.5,
              whiteSpace: 'nowrap',
            }}
          >
            {pulling ? 'Pulling...' : 'Pull Model'}
          </button>
        </div>
        {pullProgress && (
          <div style={{
            marginTop: '6px', fontSize: '10px', fontFamily: theme.fontMono,
            color: pullProgress.startsWith('Error') ? theme.red
                 : pullProgress.startsWith('Done') ? theme.green
                 : theme.textMuted,
          }}>
            {pullProgress}
          </div>
        )}
      </div>

      <div style={{
        marginTop: '12px',
        padding: '12px',
        background: theme.bg2,
        borderRadius: '6px',
        fontSize: '11px',
        color: theme.textMuted,
        lineHeight: 1.5,
      }}>
        <strong style={{ color: theme.textSecondary }}>Recommended:</strong>{' '}
        <span style={{ fontFamily: theme.fontMono, color: theme.blue }}>qwen2.5-coder:14b</span>{' '}
        for best PCB design analysis. Requires ~9GB VRAM.
        Install Ollama from <span style={{ color: theme.blue }}>ollama.ai</span> and
        use the Pull button above or run{' '}
        <span style={{ fontFamily: theme.fontMono, color: theme.textSecondary }}>
          ollama pull qwen2.5-coder:14b
        </span>.
      </div>
    </div>
  );
};

// ─── Tab configuration ───────────────────────────────────────────────────────

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: '\u2699' },
  { id: 'grid', label: 'Grid & Snap', icon: '\u2B1A' },
  { id: 'defaults', label: 'Defaults', icon: '\u2630' },
  { id: 'theme', label: 'Theme', icon: '\u263E' },
  { id: 'ollama', label: 'Ollama', icon: '\u2B50' },
];

// ─── Main Dialog Component ───────────────────────────────────────────────────

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [settings, setSettings] = useState<RouteAISettings>(DEFAULT_SETTINGS);
  const [dirty, setDirty] = useState(false);

  // Load settings when dialog opens
  useEffect(() => {
    if (open) {
      setSettings(loadSettings());
      setDirty(false);
      setActiveTab('general');
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleChange = useCallback((patch: Partial<RouteAISettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  }, []);

  const handleSave = useCallback(() => {
    saveSettings(settings);

    // Apply grid & snap settings to the editor store
    const editorStore = useEditorStore.getState();
    if (settings.snapToGrid !== editorStore.snapToGrid) {
      editorStore.toggleSnap();
    }

    // Dispatch a custom event so other stores/components can react to settings changes
    window.dispatchEvent(new CustomEvent('routeai-settings-changed', { detail: settings }));

    setDirty(false);
    onClose();
  }, [settings, onClose]);

  const handleReset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    setDirty(true);
  }, []);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: `1px solid ${theme.bg3}`,
        }}>
          <div style={{ fontSize: '15px', fontWeight: 600 }}>Settings</div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: theme.textMuted,
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
            title="Close"
          >
            &#x2715;
          </button>
        </div>

        {/* Body: sidebar + content */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: '380px' }}>
          {/* Sidebar */}
          <div style={{
            width: '150px',
            minWidth: '150px',
            borderRight: `1px solid ${theme.bg3}`,
            background: theme.bg0,
            padding: '8px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                style={sidebarTabStyle(activeTab === tab.id)}
                onClick={() => setActiveTab(tab.id)}
              >
                <span style={{ marginRight: '6px' }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{
            flex: 1,
            padding: '16px 24px',
            overflowY: 'auto',
          }}>
            {activeTab === 'general' && <GeneralTab settings={settings} onChange={handleChange} />}
            {activeTab === 'grid' && <GridSnapTab settings={settings} onChange={handleChange} />}
            {activeTab === 'defaults' && <DefaultsTab settings={settings} onChange={handleChange} />}
            {activeTab === 'theme' && <ThemeTab settings={settings} onChange={handleChange} />}
            {activeTab === 'ollama' && <OllamaTab settings={settings} onChange={handleChange} />}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px',
          borderTop: `1px solid ${theme.bg3}`,
        }}>
          <button
            onClick={handleReset}
            style={{
              background: 'none',
              border: `1px solid ${theme.bg3}`,
              borderRadius: '4px',
              color: theme.textMuted,
              fontSize: '12px',
              fontFamily: theme.fontSans,
              padding: '5px 14px',
              cursor: 'pointer',
            }}
          >
            Reset to Defaults
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                background: theme.bg3,
                border: `1px solid ${theme.bg3}`,
                borderRadius: '4px',
                color: theme.textSecondary,
                fontSize: '12px',
                fontFamily: theme.fontSans,
                padding: '5px 14px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                background: dirty ? theme.blue : theme.bg3,
                border: `1px solid ${dirty ? theme.blue : theme.bg3}`,
                borderRadius: '4px',
                color: dirty ? '#fff' : theme.textMuted,
                fontSize: '12px',
                fontFamily: theme.fontSans,
                fontWeight: 600,
                padding: '5px 18px',
                cursor: dirty ? 'pointer' : 'default',
                transition: 'all 0.15s',
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsDialog;
