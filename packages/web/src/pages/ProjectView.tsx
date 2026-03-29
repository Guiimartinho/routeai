import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProjectStore } from '../stores/projectStore';
import { useAuthStore } from '../stores/authStore';
import { useWorkflowStore, type WorkflowStageId } from '../stores/workflowStore';
import { useWebSocket, WSMessage } from '../hooks/useWebSocket';
import PCBViewer from '../components/pcb/PCBViewer';
import SchematicEditor from '../components/schematic/SchematicEditor';
import LayerPanel from '../components/sidebar/LayerPanel';
import NetPanel from '../components/sidebar/NetPanel';
import ComponentPanel from '../components/sidebar/ComponentPanel';
import ReviewPanel from '../components/review/ReviewPanel';
import ChatPanel from '../components/chat/ChatPanel';
import RoutingPanel from '../components/routing/RoutingPanel';
import PlacementPanel from '../components/placement/PlacementPanel';
import StatusBar from '../components/common/StatusBar';
import WorkflowBar from '../components/workflow/WorkflowBar';
import AIAssistant from '../components/workflow/AIAssistant';
import ExportPanel from '../components/workflow/ExportPanel';
import PlacementPreview from '../components/workflow/PlacementPreview';
import CrossProbe from '../components/workflow/CrossProbe';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowLeft,
  Download,
  Play,
  PanelLeftClose,
  PanelLeftOpen,
  Layers,
  Network,
  Component,
  Loader2,
  ArrowRightLeft,
  Route,
  LayoutGrid,
  ShieldCheck,
  MessageSquare,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Stage -> right panel tab mapping
// ---------------------------------------------------------------------------

function rightTabForStage(stage: WorkflowStageId): string {
  switch (stage) {
    case 'schematic':
      return 'chat';
    case 'review':
      return 'review';
    case 'export':
      return 'export';
    case 'placement':
      return 'placement';
    case 'routing':
      return 'routing';
    case 'drc':
      return 'review';
    case 'manufacturing':
      return 'export';
    default:
      return 'review';
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);

  const {
    currentProject,
    boardData,
    boardLoading,
    reviewResult,
    reviewLoading,
    fetchProject,
    fetchBoardData,
    fetchReview,
    startReview,
    clearCurrentProject,
  } = useProjectStore();

  const currentStage = useWorkflowStore((s) => s.currentStage);
  const goToStage = useWorkflowStore((s) => s.goToStage);
  const splitViewEnabled = useWorkflowStore((s) => s.splitViewEnabled);
  const resetWorkflow = useWorkflowStore((s) => s.resetWorkflow);

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [leftTab, setLeftTab] = useState('layers');
  const [rightTab, setRightTab] = useState('review');

  // Sync right tab with workflow stage
  useEffect(() => {
    setRightTab(rightTabForStage(currentStage));
  }, [currentStage]);

  // Fetch project data
  useEffect(() => {
    if (id) {
      fetchProject(id);
      fetchBoardData(id);
      fetchReview(id);
    }
    return () => {
      clearCurrentProject();
      resetWorkflow();
    };
  }, [id, fetchProject, fetchBoardData, fetchReview, clearCurrentProject, resetWorkflow]);

  // Auto-advance workflow when board data is loaded (project already parsed)
  useEffect(() => {
    if (boardData && currentStage === 'schematic') {
      goToStage('review');
    }
  }, [boardData, currentStage, goToStage]);

  // WebSocket for real-time updates
  const handleWSMessage = useCallback(
    (msg: WSMessage) => {
      if (msg.type === 'review_complete' && id) {
        fetchReview(id);
      }
      if (msg.type === 'review_progress') {
        // Could update a progress indicator
      }
    },
    [id, fetchReview]
  );

  useWebSocket({
    url: '/ws',
    token,
    projectId: id,
    onMessage: handleWSMessage,
    autoReconnect: false,
    maxReconnectAttempts: 0,
  });

  const handleStartReview = async () => {
    if (id) {
      await startReview(id);
      setRightTab('review');
      goToStage('review');
    }
  };

  const handleExport = async () => {
    if (!id || !reviewResult) return;
    try {
      const { exportReview } = await import('../api/projects');
      const blob = await exportReview(id, reviewResult.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentProject?.name ?? 'review'}-report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // handled
    }
  };

  if (!id) return null;

  // ---------------------------------------------------------------------------
  // Determine which main canvas to show based on current stage
  // ---------------------------------------------------------------------------

  const renderMainCanvas = () => {
    // Placement stage shows placement preview
    if (currentStage === 'placement') {
      return <PlacementPreview />;
    }

    // Schematic stage: show schematic editor only if no board data yet
    if (currentStage === 'schematic' && !boardData && !boardLoading) {
      return <SchematicEditor />;
    }

    // Split view: schematic left, board right
    if (splitViewEnabled && boardData) {
      return (
        <div className="flex h-full">
          <div className="flex-1 border-r border-gray-800 overflow-hidden">
            <SchematicEditor />
          </div>
          <div className="flex-1 overflow-hidden relative bg-gray-950">
            {renderBoardViewer()}
          </div>
        </div>
      );
    }

    // Default: show board viewer (all other stages)
    return renderBoardViewer();
  };

  const renderBoardViewer = () => {
    if (boardLoading) {
      return (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-gray-400">Loading board data...</p>
          </div>
        </div>
      );
    }
    if (boardData) {
      return <PCBViewer boardData={boardData} />;
    }
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <p className="text-gray-500">No board data available</p>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Right panel tabs based on stage
  // ---------------------------------------------------------------------------

  const rightPanelTabs = () => {
    const tabs: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: string | number }[] = [
      { id: 'review', label: 'Review', icon: ShieldCheck, badge: reviewResult?.totalIssues },
      { id: 'chat', label: 'Chat', icon: MessageSquare },
    ];

    // Add context-specific tabs
    if (currentStage === 'export' || currentStage === 'manufacturing') {
      tabs.push({ id: 'export', label: 'Export', icon: Download });
    }
    if (currentStage === 'placement') {
      tabs.push({ id: 'placement', label: 'Placement', icon: LayoutGrid });
    }
    if (currentStage === 'routing') {
      tabs.push({ id: 'routing', label: 'Routing', icon: Route });
    }

    // Cross-probe is always available
    tabs.push({ id: 'crossprobe', label: 'X-Probe', icon: ArrowRightLeft });

    return tabs;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Header */}
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="btn-ghost p-1.5" title="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-5 w-px bg-gray-700" />
          <h1 className="font-semibold text-sm truncate max-w-[300px]">
            {currentProject?.name ?? 'Loading...'}
          </h1>
          {currentProject && (
            <span className="text-xs text-gray-500 uppercase">{currentProject.format}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleStartReview}
            disabled={reviewLoading || !boardData}
            className="btn-primary text-sm py-1.5 flex items-center gap-1.5"
          >
            {reviewLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Reviewing...
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run Review
              </>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={!reviewResult}
            className="btn-secondary text-sm py-1.5 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </header>

      {/* Workflow progress bar */}
      <WorkflowBar />

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <div
          className={`shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-200 ${
            leftSidebarOpen ? 'w-64' : 'w-10'
          }`}
        >
          {/* Sidebar toggle */}
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="p-2.5 text-gray-400 hover:text-gray-200 border-b border-gray-800"
            title={leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {leftSidebarOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>

          {leftSidebarOpen ? (
            <Tabs.Root value={leftTab} onValueChange={setLeftTab} className="flex-1 flex flex-col overflow-hidden">
              <Tabs.List className="flex border-b border-gray-800 shrink-0">
                <Tabs.Trigger
                  value="layers"
                  className="flex-1 px-2 py-2 text-xs font-medium text-gray-500 data-[state=active]:text-brand-400 data-[state=active]:border-b-2 data-[state=active]:border-brand-400 flex items-center justify-center gap-1"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Layers
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="nets"
                  className="flex-1 px-2 py-2 text-xs font-medium text-gray-500 data-[state=active]:text-brand-400 data-[state=active]:border-b-2 data-[state=active]:border-brand-400 flex items-center justify-center gap-1"
                >
                  <Network className="w-3.5 h-3.5" />
                  Nets
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="components"
                  className="flex-1 px-2 py-2 text-xs font-medium text-gray-500 data-[state=active]:text-brand-400 data-[state=active]:border-b-2 data-[state=active]:border-brand-400 flex items-center justify-center gap-1"
                >
                  <Component className="w-3.5 h-3.5" />
                  Parts
                </Tabs.Trigger>
              </Tabs.List>

              <div className="flex-1 overflow-auto">
                <Tabs.Content value="layers" className="h-full">
                  <LayerPanel />
                </Tabs.Content>
                <Tabs.Content value="nets" className="h-full">
                  <NetPanel />
                </Tabs.Content>
                <Tabs.Content value="components" className="h-full">
                  <ComponentPanel />
                </Tabs.Content>
              </div>
            </Tabs.Root>
          ) : (
            /* Collapsed icon buttons */
            <div className="flex flex-col items-center gap-1 pt-1">
              <button
                onClick={() => { setLeftSidebarOpen(true); setLeftTab('layers'); }}
                className="p-2 text-gray-500 hover:text-gray-300"
                title="Layers"
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setLeftSidebarOpen(true); setLeftTab('nets'); }}
                className="p-2 text-gray-500 hover:text-gray-300"
                title="Nets"
              >
                <Network className="w-4 h-4" />
              </button>
              <button
                onClick={() => { setLeftSidebarOpen(true); setLeftTab('components'); }}
                className="p-2 text-gray-500 hover:text-gray-300"
                title="Components"
              >
                <Component className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Center: Main canvas (Schematic, Board, Placement, or Split) */}
        <div className="flex-1 relative overflow-hidden bg-gray-950">
          {renderMainCanvas()}
        </div>

        {/* Right panel */}
        <div className="w-96 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
          <Tabs.Root value={rightTab} onValueChange={setRightTab} className="flex-1 flex flex-col overflow-hidden">
            <Tabs.List className="flex border-b border-gray-800 shrink-0 overflow-x-auto">
              {rightPanelTabs().map((tab) => {
                const TabIcon = tab.icon;
                return (
                  <Tabs.Trigger
                    key={tab.id}
                    value={tab.id}
                    className="flex-shrink-0 px-3 py-2.5 text-xs font-medium text-gray-500 data-[state=active]:text-brand-400 data-[state=active]:border-b-2 data-[state=active]:border-brand-400 flex items-center gap-1.5"
                  >
                    <TabIcon className="w-3.5 h-3.5" />
                    {tab.label}
                    {tab.badge !== undefined && tab.badge !== 0 && (
                      <span className="ml-0.5 text-[10px] bg-gray-800 px-1.5 py-0.5 rounded-full">
                        {tab.badge}
                      </span>
                    )}
                  </Tabs.Trigger>
                );
              })}
            </Tabs.List>

            <Tabs.Content value="review" className="flex-1 overflow-hidden">
              <ReviewPanel />
            </Tabs.Content>
            <Tabs.Content value="chat" className="flex-1 overflow-hidden">
              <ChatPanel projectId={id} />
            </Tabs.Content>
            <Tabs.Content value="export" className="flex-1 overflow-hidden">
              <ExportPanel />
            </Tabs.Content>
            <Tabs.Content value="placement" className="flex-1 overflow-hidden">
              <PlacementPanel />
            </Tabs.Content>
            <Tabs.Content value="routing" className="flex-1 overflow-hidden">
              <RoutingPanel />
            </Tabs.Content>
            <Tabs.Content value="crossprobe" className="flex-1 overflow-hidden">
              <CrossProbe projectId={id} />
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar />

      {/* Floating AI Assistant */}
      <AIAssistant projectId={id} />
    </div>
  );
}
