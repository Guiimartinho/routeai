import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useProjectStore } from './store/projectStore';
import { theme } from './styles/theme';
import type { EditorTab } from './types';
import StatusBar from './components/StatusBar';
import ErrorBoundary from './components/ErrorBoundary';
import SettingsDialog from './components/SettingsDialog';
import ShortcutsOverlay from './components/ShortcutsOverlay';
import TemplateDialog from './components/TemplateDialog';
import SymbolEditor from './components/SymbolEditor';
import FootprintEditor from './components/FootprintEditor';
import ImportDialog from './components/ImportDialog';
import PDFExportDialog from './components/PDFExportDialog';
import GitPanel from './components/GitPanel';
import type { CrossProbeDetail } from './engine/crossProbe';
import type { TemplateResult } from './engine/designTemplates';

// Lazy load heavy editors and AI panels
const SchematicEditor = lazy(() => import('./components/SchematicEditor'));
const BoardEditor = lazy(() => import('./components/BoardEditor'));
const AIDesignReview = lazy(() => import('./components/AIDesignReview'));
const AIBoardWizard = lazy(() => import('./components/AIBoardWizard'));
const AIRoutingAssistant = lazy(() => import('./components/AIRoutingAssistant'));
const DesignRuleCheck = lazy(() => import('./components/DesignRuleCheck'));
const ERCPanel = lazy(() => import('./components/ERCPanel'));
const GerberExport = lazy(() => import('./components/GerberExport'));
const AIPanel = lazy(() => import('./components/AIPanel'));
const BOMPanel = lazy(() => import('./components/BOMPanel'));
const EMCPanel = lazy(() => import('./components/EMCPanel'));
const SimulationPanel = lazy(() => import('./components/SimulationPanel'));

// ─── Constants ──────────────────────────────────────────────────────────────
const AUTOSAVE_INTERVAL = 30_000; // 30 seconds

// ─── Loading spinner ────────────────────────────────────────────────────────
const Loader: React.FC = () => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.bg0 }}>
    <div style={{ textAlign: 'center', color: theme.textMuted }}>
      <div style={{ fontSize: '24px', marginBottom: '8px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>&#x27F3;</div>
      <div style={{ fontSize: theme.fontSm }}>Loading editor...</div>
    </div>
  </div>
);

// ─── 3D Board Viewer (lazy loaded) ──────────────────────────────────────────
const BoardViewer3D = lazy(() => import('./components/BoardViewer3D'));

// ─── Tab button ─────────────────────────────────────────────────────────────
const TabBtn: React.FC<{ label: string; icon: string; active: boolean; onClick: () => void }> = ({ label, icon, active, onClick }) => (
  <button onClick={onClick} style={{
    background: active ? theme.bg2 : 'transparent',
    color: active ? theme.textPrimary : theme.textSecondary,
    border: 'none',
    borderBottom: active ? `2px solid ${theme.blue}` : '2px solid transparent',
    padding: '0 14px',
    height: '100%',
    fontSize: theme.fontSm,
    fontFamily: theme.fontSans,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    display: 'flex', alignItems: 'center', gap: '6px',
  }}>
    <span style={{ fontSize: '14px' }}>{icon}</span>
    {label}
  </button>
);

// ─── Header button style ────────────────────────────────────────────────────
const hdrBtnStyle: React.CSSProperties = {
  background: theme.bg3,
  border: `1px solid ${theme.bg3}`,
  borderRadius: '4px',
  color: theme.textSecondary,
  fontSize: '11px',
  fontFamily: 'inherit',
  fontWeight: 500,
  padding: '3px 10px',
  cursor: 'pointer',
  transition: 'all 0.12s',
  height: 24,
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  whiteSpace: 'nowrap' as const,
};

const hdrBtnAccent: React.CSSProperties = {
  ...hdrBtnStyle,
  borderColor: theme.blue,
  color: theme.blue,
};

const hdrBtnGreen: React.CSSProperties = {
  ...hdrBtnStyle,
  borderColor: theme.green,
  color: theme.green,
};

// ─── File menu dropdown ─────────────────────────────────────────────────────

interface FileMenuProps {
  onClose: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

const FileMenu: React.FC<FileMenuProps> = ({ onClose, onNew, onOpen, onSave, onSaveAs }) => {
  const items = [
    { label: 'New Project', shortcut: 'Ctrl+N', action: onNew },
    { label: 'Open Project...', shortcut: 'Ctrl+O', action: onOpen },
    { type: 'sep' as const },
    { label: 'Save to Browser', shortcut: 'Ctrl+S', action: onSave },
    { label: 'Save as File...', shortcut: 'Ctrl+Shift+S', action: onSaveAs },
  ];

  return (
    <div
      style={{
        position: 'absolute',
        top: '36px',
        left: '8px',
        background: theme.bg2,
        border: `1px solid ${theme.bg3}`,
        borderRadius: '6px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        padding: '4px 0',
        zIndex: 2000,
        minWidth: '200px',
      }}
      onMouseLeave={onClose}
    >
      {items.map((item, i) => {
        if ('type' in item && item.type === 'sep') {
          return <div key={i} style={{ height: 1, background: theme.bg3, margin: '4px 0' }} />;
        }
        const it = item as { label: string; shortcut: string; action: () => void };
        return (
          <div
            key={i}
            style={{
              padding: '6px 14px',
              fontSize: '12px',
              fontFamily: theme.fontSans,
              color: theme.textPrimary,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              transition: 'background 0.08s',
            }}
            onClick={() => { it.action(); onClose(); }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = theme.bg3; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
          >
            <span>{it.label}</span>
            <span style={{ color: theme.textMuted, fontSize: '10px', fontFamily: theme.fontMono, marginLeft: '16px' }}>
              {it.shortcut}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main App ───────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<EditorTab>('schematic');
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showSymbolEditor, setShowSymbolEditor] = useState(false);
  const [showFootprintEditor, setShowFootprintEditor] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPDFExport, setShowPDFExport] = useState(false);
  const [showGitPanel, setShowGitPanel] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cross-probe state ──────────────────────────────────────────────
  const [crossProbeRef, setCrossProbeRef] = useState<{ source: 'sch' | 'board'; ref: string } | null>(null);
  const [splitView, setSplitView] = useState(false);

  // Project store
  const {
    metadata, isDirty,
    saveToLocalStorage, loadFromLocalStorage,
    downloadProject, uploadProject, newProject,
    syncSchematicToBoard, extractNetlist,
  } = useProjectStore();

  // ── Load from localStorage on mount ─────────────────────────────────
  useEffect(() => {
    loadFromLocalStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for toolbar navigation events ──────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as EditorTab;
      if (tab) setActiveTab(tab);
    };
    window.addEventListener('routeai-navigate', handler);
    return () => window.removeEventListener('routeai-navigate', handler);
  }, []);

  // ── Listen for PDF export dialog event ──────────────────────────────
  useEffect(() => {
    const handler = () => setShowPDFExport(true);
    window.addEventListener('routeai-open-pdf-export', handler);
    return () => window.removeEventListener('routeai-open-pdf-export', handler);
  }, []);

  // ── Listen for cross-probe events ─────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CrossProbeDetail>).detail;
      if (!detail) return;
      setCrossProbeRef(detail);
      // Switch to the opposite tab (unless in split-view mode)
      if (!splitView) {
        if (detail.source === 'sch') {
          setActiveTab('board');
        } else {
          setActiveTab('schematic');
        }
      }
    };
    window.addEventListener('routeai-crossprobe', handler);
    return () => window.removeEventListener('routeai-crossprobe', handler);
  }, [splitView]);

  // ── Autosave every 30 seconds if dirty ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (useProjectStore.getState().isDirty) {
        useProjectStore.getState().saveToLocalStorage();
      }
    }, AUTOSAVE_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  // ── Keyboard shortcuts for file operations ──────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      switch (e.key.toLowerCase()) {
        case 'n':
          if (!e.shiftKey) {
            e.preventDefault();
            handleNew();
          }
          break;
        case 'o':
          e.preventDefault();
          handleOpen();
          break;
        case 's':
          e.preventDefault();
          if (e.shiftKey) {
            handleSaveAs();
          } else {
            handleSave();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Keyboard shortcut for Help overlay (? or F1) ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === '?' || e.key === 'F1') {
        e.preventDefault();
        setShowShortcuts((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── File operations ─────────────────────────────────────────────────
  const handleNew = useCallback(() => {
    if (useProjectStore.getState().isDirty) {
      const ok = window.confirm('You have unsaved changes. Create a new project anyway?');
      if (!ok) return;
    }
    const name = window.prompt('Project name:', 'Untitled Project');
    if (name !== null) {
      newProject(name || undefined);
    }
  }, [newProject]);

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadProject(file);
    } catch (err) {
      window.alert(`Failed to open project: ${(err as Error).message}`);
    }
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, [uploadProject]);

  const handleSave = useCallback(() => {
    saveToLocalStorage();
    useProjectStore.getState().markClean();
  }, [saveToLocalStorage]);

  const handleSaveAs = useCallback(() => {
    downloadProject();
  }, [downloadProject]);

  const handleSyncToBoard = useCallback(() => {
    syncSchematicToBoard();
    setActiveTab('board');
  }, [syncSchematicToBoard]);

  const handleExtractNetlist = useCallback(() => {
    const nets = extractNetlist();
    window.alert(`Extracted ${nets.length} net(s) from schematic.`);
  }, [extractNetlist]);

  const handleGenerateTemplate = useCallback((result: TemplateResult, templateName: string) => {
    const store = useProjectStore.getState();
    // Add all components, wires, and labels from the template
    for (const comp of result.components) {
      store.addSchComponent(comp);
    }
    for (const wire of result.wires) {
      store.addSchWire(wire);
    }
    for (const label of result.labels) {
      store.addSchLabel(label);
    }
    setActiveTab('schematic');
  }, []);

  // ── Tabs config (full EDA workflow) ─────────────────────────────────
  const tabs: { id: EditorTab; label: string; icon: string }[] = [
    { id: 'schematic', label: 'Schematic', icon: '\u{1F4CB}' },
    { id: 'board', label: 'Board', icon: '\u{1F532}' },
    { id: 'ai-review', label: 'AI Review', icon: '\u{1F50D}' },
    { id: 'ai-placement', label: 'AI Placement', icon: '\u{1F4CD}' },
    { id: 'ai-routing', label: 'AI Routing', icon: '\u{1F500}' },
    { id: 'drc', label: 'DRC', icon: '\u{2705}' },
    { id: 'erc', label: 'ERC', icon: '\u{26A1}' },
    { id: 'bom', label: 'BOM', icon: '\u{1F4B0}' },
    { id: 'emc', label: 'EMC', icon: '\u{1F6E1}' },
    { id: 'simulation', label: 'SPICE', icon: '\u{1F4CA}' },
    { id: 'export', label: 'Export', icon: '\u{1F4E6}' },
    { id: '3d', label: '3D', icon: '\u{1F9CA}' },
  ];

  // When syncing to board, ask if AI should place components
  const handleSyncWithAI = useCallback(() => {
    syncSchematicToBoard();
    const useAI = window.confirm(
      'Schematic synced to board!\n\n' +
      'Want AI to distribute components optimally?\n' +
      '(Separates power/digital/analog zones, places decoupling caps near ICs, etc.)'
    );
    if (useAI) {
      setActiveTab('ai-placement');
    } else {
      setActiveTab('board');
    }
  }, [syncSchematicToBoard]);

  return (
    <ErrorBoundary>
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column',
      background: theme.bg0, color: theme.textPrimary,
      fontFamily: theme.fontSans,
    }}>
      {/* Hidden file input for Open */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.routeai.json,.kicad_sch,.kicad_pcb,.kicad_pro,.sch,.brd,.zip"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* Top bar with file menu, tabs, actions */}
      <header style={{
        height: '36px', minHeight: '36px',
        display: 'flex', alignItems: 'center',
        background: theme.bg1, borderBottom: `1px solid ${theme.bg3}`,
        padding: '0 8px', userSelect: 'none',
        position: 'relative',
        zIndex: 1000,
      }}>
        {/* Logo + File menu trigger */}
        <span
          style={{
            fontWeight: 700, fontSize: '14px', color: theme.blue,
            marginRight: '4px', letterSpacing: '-0.3px', cursor: 'pointer',
          }}
          onClick={() => setShowFileMenu(!showFileMenu)}
        >
          &#x2B21; RouteAI
        </span>

        {/* File button */}
        <button
          style={{
            ...hdrBtnStyle,
            marginRight: '8px',
            background: showFileMenu ? theme.bg3 : 'transparent',
            border: 'none',
          }}
          onClick={() => setShowFileMenu(!showFileMenu)}
        >
          File
        </button>

        {/* File dropdown */}
        {showFileMenu && (
          <FileMenu
            onClose={() => setShowFileMenu(false)}
            onNew={handleNew}
            onOpen={handleOpen}
            onSave={handleSave}
            onSaveAs={handleSaveAs}
          />
        )}

        {/* Import button */}
        <button
          style={{
            ...hdrBtnStyle,
            marginRight: '8px',
            background: 'transparent',
            border: 'none',
          }}
          onClick={() => setShowImportDialog(true)}
          title="Import KiCad or Eagle files"
        >
          {'\u2191'} Import
        </button>

        {/* Editor tabs */}
        <nav style={{ display: 'flex', height: '100%' }}>
          {tabs.map(t => (
            <TabBtn key={t.id} label={t.label} icon={t.icon}
              active={activeTab === t.id} onClick={() => setActiveTab(t.id)} />
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Symbol Editor */}
          <button
            style={hdrBtnStyle}
            onClick={() => setShowSymbolEditor(true)}
            title="Create or edit schematic symbols"
          >
            {'\u2699'} Symbol Editor
          </button>

          {/* Footprint Editor */}
          <button
            style={hdrBtnStyle}
            onClick={() => setShowFootprintEditor(true)}
            title="Create or edit PCB footprints"
          >
            {'\u2B22'} Footprint Editor
          </button>

          {/* Design Templates */}
          <button
            style={hdrBtnAccent}
            onClick={() => setShowTemplates(true)}
            title="Generate schematic from pre-built design templates"
          >
            {'\u2B22'} Templates
          </button>

          {/* Extract Netlist */}
          <button
            style={hdrBtnStyle}
            onClick={handleExtractNetlist}
            title="Extract netlist from schematic (trace wire connectivity)"
          >
            Extract Netlist
          </button>

          {/* Update Board from Schematic (with AI option) */}
          <button
            style={hdrBtnAccent}
            onClick={handleSyncWithAI}
            title="Sync schematic to board — AI will ask to auto-place components"
          >
            &#x2728; Update Board
          </button>

          {/* Quick save */}
          <button
            style={hdrBtnGreen}
            onClick={handleSaveAs}
            title="Save project as JSON file"
          >
            Save
          </button>

          {/* Version Control */}
          <button
            style={hdrBtnStyle}
            onClick={() => setShowGitPanel(true)}
            title="Version control -- save, compare, and revert design versions"
          >
            {'\u{1F4C3}'} Versions
          </button>

          {/* Split view toggle */}
          <button
            style={splitView ? hdrBtnAccent : hdrBtnStyle}
            onClick={() => setSplitView(v => !v)}
            title="Split view: Schematic + Board side by side"
          >
            {splitView ? '\u25A3 Split' : '\u25A1 Split'}
          </button>

          {/* Help / Shortcuts */}
          <button
            style={hdrBtnStyle}
            onClick={() => setShowShortcuts(true)}
            title="Keyboard Shortcuts (? or F1)"
          >
            ? Help
          </button>

          {/* Settings */}
          <button
            style={hdrBtnStyle}
            onClick={() => setShowSettings(true)}
            title="Settings / Preferences"
          >
            &#x2699; Settings
          </button>
        </div>

        {/* Unsaved indicator + version */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px' }}>
          {isDirty && (
            <span style={{
              fontSize: '10px',
              color: theme.orange,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
            }}>
              &#x25CF; Unsaved
            </span>
          )}
          <span style={{ fontSize: '10px', color: theme.textMuted }}>
            {metadata.name}
          </span>
          <span style={{ fontSize: '10px', color: theme.textMuted, opacity: 0.5 }}>
            v0.2.0
          </span>
        </div>
      </header>

      {/* Editor area */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {splitView ? (
          /* ── Split view: Schematic left, Board right ──────────── */
          <>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: `1px solid ${theme.bg3}` }}>
              <Suspense fallback={<Loader />}>
                <SchematicEditor crossProbeRef={crossProbeRef} />
              </Suspense>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Suspense fallback={<Loader />}>
                <BoardEditor crossProbeRef={crossProbeRef} />
              </Suspense>
            </div>
          </>
        ) : (
          /* ── Single tab view ──────────────────────────────────── */
          <>
            <Suspense fallback={<Loader />}>
              {activeTab === 'schematic' && <SchematicEditor crossProbeRef={crossProbeRef} />}
              {activeTab === 'board' && <BoardEditor crossProbeRef={crossProbeRef} />}
              {activeTab === 'ai-review' && <AIDesignReview />}
              {activeTab === 'ai-placement' && <AIBoardWizard />}
              {activeTab === 'ai-routing' && <AIRoutingAssistant />}
              {activeTab === 'drc' && <DesignRuleCheck />}
              {activeTab === 'erc' && <ERCPanel />}
              {activeTab === 'bom' && <BOMPanel />}
              {activeTab === 'emc' && <EMCPanel />}
              {activeTab === 'simulation' && <SimulationPanel />}
              {activeTab === 'export' && <GerberExport />}
              {activeTab === '3d' && <BoardViewer3D />}
            </Suspense>

            {/* AI Assistant side panel - always visible */}
            {(activeTab === 'schematic' || activeTab === 'board' || splitView) && (
              <Suspense fallback={null}>
                <AIPanel />
              </Suspense>
            )}
          </>
        )}
      </main>

      {/* Status bar */}
      <StatusBar />

      {/* Settings dialog */}
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Keyboard shortcuts overlay */}
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Design template dialog */}
      <TemplateDialog
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onGenerate={handleGenerateTemplate}
      />

      {/* Symbol editor dialog */}
      <SymbolEditor open={showSymbolEditor} onClose={() => setShowSymbolEditor(false)} />

      {/* Footprint editor dialog */}
      <FootprintEditor open={showFootprintEditor} onClose={() => setShowFootprintEditor(false)} />

      {/* Import dialog */}
      <ImportDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImported={(tab) => setActiveTab(tab)}
      />

      {/* PDF Export dialog */}
      <PDFExportDialog open={showPDFExport} onClose={() => setShowPDFExport(false)} />

      {/* Git version control panel */}
      <GitPanel open={showGitPanel} onClose={() => setShowGitPanel(false)} />
    </div>
    </ErrorBoundary>
  );
};

export default App;
