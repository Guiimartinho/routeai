/**
 * Zustand store for the end-to-end design workflow.
 *
 * Tracks the current stage (schematic -> review -> export -> placement ->
 * routing -> drc -> manufacturing), AI assistant state, and overall progress.
 */

import { create } from 'zustand';
import type { BoardReference } from '../types/review';
import * as workflowApi from '../api/workflow';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowStageId =
  | 'schematic'
  | 'review'
  | 'export'
  | 'placement'
  | 'routing'
  | 'drc'
  | 'manufacturing';

export type StageStatus = 'pending' | 'active' | 'completed' | 'error';

export interface StageInfo {
  id: WorkflowStageId;
  name: string;
  icon: string;
  status: StageStatus;
  description: string;
}

export type AISuggestionType = 'placement' | 'review' | 'routing' | 'drc_fix' | 'component';

export interface AISuggestion {
  type: AISuggestionType;
  title: string;
  description: string;
  action: string;
  data: Record<string, unknown>;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  context?: string;
  references?: BoardReference[];
}

// ---------------------------------------------------------------------------
// Default stages
// ---------------------------------------------------------------------------

const DEFAULT_STAGES: StageInfo[] = [
  { id: 'schematic', name: 'Schematic', icon: 'FileText', status: 'active', description: 'Design your schematic' },
  { id: 'review', name: 'Review', icon: 'Search', status: 'pending', description: 'AI design review' },
  { id: 'export', name: 'Export', icon: 'Download', status: 'pending', description: 'Export in multiple formats' },
  { id: 'placement', name: 'Placement', icon: 'LayoutGrid', status: 'pending', description: 'Component placement' },
  { id: 'routing', name: 'Routing', icon: 'Route', status: 'pending', description: 'Trace routing' },
  { id: 'drc', name: 'DRC', icon: 'ShieldCheck', status: 'pending', description: 'Design rule check' },
  { id: 'manufacturing', name: 'Manufacturing', icon: 'Factory', status: 'pending', description: 'Gerber & output files' },
];

// ---------------------------------------------------------------------------
// Stage-specific AI suggestions
// ---------------------------------------------------------------------------

function buildSuggestionForStage(stage: WorkflowStageId): AISuggestion | null {
  switch (stage) {
    case 'schematic':
      return {
        type: 'review',
        title: 'Ready to review?',
        description: 'Your schematic looks complete. Want me to run an AI design review to check for errors, missing connections, and best-practice violations?',
        action: 'Run AI Review',
        data: {},
      };
    case 'review':
      return {
        type: 'placement',
        title: 'Review complete',
        description: 'I found some issues to address. Once you are satisfied, I can auto-place components on the board using AI-optimized floorplanning.',
        action: 'Auto-Place Components',
        data: {},
      };
    case 'placement':
      return {
        type: 'routing',
        title: 'Placement looks good',
        description: 'Components are placed. Ready to route? I suggest starting with high-speed differential pairs (USB, DDR) before general signals.',
        action: 'Start AI Routing',
        data: {},
      };
    case 'routing':
      return {
        type: 'drc_fix',
        title: 'Routing complete',
        description: 'All nets have been routed. Let me run a full DRC check to catch any violations before manufacturing output.',
        action: 'Run DRC',
        data: {},
      };
    case 'drc':
      return {
        type: 'component',
        title: 'DRC passed',
        description: 'Your design is clean. Ready to generate manufacturing outputs (Gerber, BOM, Pick & Place)?',
        action: 'Generate Outputs',
        data: {},
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface WorkflowState {
  // Current stage
  currentStage: WorkflowStageId;
  stages: StageInfo[];

  // AI assistant state
  aiSuggestion: AISuggestion | null;
  aiChatMessages: AIChatMessage[];
  aiIsThinking: boolean;
  aiPanelOpen: boolean;

  // Progress
  overallProgress: number;

  // Cross-probe
  crossProbeSource: 'schematic' | 'board' | null;
  crossProbeElementId: string | null;
  splitViewEnabled: boolean;

  // Actions
  advanceStage: () => void;
  goToStage: (stage: WorkflowStageId) => void;
  setStageStatus: (stageId: WorkflowStageId, status: StageStatus) => void;
  setAISuggestion: (suggestion: AISuggestion | null) => void;
  addAIChatMessage: (message: AIChatMessage) => void;
  sendAIMessage: (projectId: string, message: string, context: string) => Promise<void>;
  requestAIPlacement: (projectId: string) => Promise<void>;
  requestAIReview: (projectId: string) => Promise<void>;
  requestAIRouting: (projectId: string) => Promise<void>;
  setAIPanelOpen: (open: boolean) => void;
  toggleAIPanel: () => void;
  setCrossProbe: (source: 'schematic' | 'board' | null, elementId: string | null) => void;
  setSplitView: (enabled: boolean) => void;
  resetWorkflow: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STAGE_ORDER: WorkflowStageId[] = [
  'schematic', 'review', 'export', 'placement', 'routing', 'drc', 'manufacturing',
];

function computeProgress(stages: StageInfo[]): number {
  const completed = stages.filter((s) => s.status === 'completed').length;
  return Math.round((completed / stages.length) * 100);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  currentStage: 'schematic',
  stages: DEFAULT_STAGES.map((s) => ({ ...s })),
  aiSuggestion: null,
  aiChatMessages: [],
  aiIsThinking: false,
  aiPanelOpen: false,
  overallProgress: 0,
  crossProbeSource: null,
  crossProbeElementId: null,
  splitViewEnabled: false,

  // -----------------------------------------------------------------------
  // Stage navigation
  // -----------------------------------------------------------------------

  advanceStage: () => {
    const { currentStage, stages } = get();
    const idx = STAGE_ORDER.indexOf(currentStage);
    if (idx < 0 || idx >= STAGE_ORDER.length - 1) return;

    const nextId = STAGE_ORDER[idx + 1];
    const updated = stages.map((s) => {
      if (s.id === currentStage) return { ...s, status: 'completed' as StageStatus };
      if (s.id === nextId) return { ...s, status: 'active' as StageStatus };
      return s;
    });

    const suggestion = buildSuggestionForStage(nextId);

    set({
      stages: updated,
      currentStage: nextId,
      overallProgress: computeProgress(updated),
      aiSuggestion: suggestion,
    });
  },

  goToStage: (stage: WorkflowStageId) => {
    const { stages } = get();
    const targetIdx = STAGE_ORDER.indexOf(stage);

    const updated = stages.map((s) => {
      const sIdx = STAGE_ORDER.indexOf(s.id);
      if (sIdx < targetIdx && s.status !== 'error') {
        return { ...s, status: 'completed' as StageStatus };
      }
      if (s.id === stage) {
        return { ...s, status: 'active' as StageStatus };
      }
      if (sIdx > targetIdx && s.status === 'active') {
        return { ...s, status: 'pending' as StageStatus };
      }
      return s;
    });

    const suggestion = buildSuggestionForStage(stage);

    set({
      stages: updated,
      currentStage: stage,
      overallProgress: computeProgress(updated),
      aiSuggestion: suggestion,
    });
  },

  setStageStatus: (stageId, status) => {
    set((state) => {
      const updated = state.stages.map((s) =>
        s.id === stageId ? { ...s, status } : s,
      );
      return { stages: updated, overallProgress: computeProgress(updated) };
    });
  },

  // -----------------------------------------------------------------------
  // AI assistant
  // -----------------------------------------------------------------------

  setAISuggestion: (suggestion) => set({ aiSuggestion: suggestion }),

  addAIChatMessage: (message) => {
    set((state) => ({
      aiChatMessages: [...state.aiChatMessages, message],
    }));
  },

  sendAIMessage: async (projectId, message, context) => {
    const userMsg: AIChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
      context,
    };

    set((state) => ({
      aiChatMessages: [...state.aiChatMessages, userMsg],
      aiIsThinking: true,
    }));

    try {
      const result = await workflowApi.sendAIChat(projectId, message, context);
      const assistantMsg: AIChatMessage = {
        id: `msg_${Date.now()}_asst`,
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        context,
        references: result.references,
      };

      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, assistantMsg],
        aiIsThinking: false,
      }));
    } catch (err: unknown) {
      const errorContent = err instanceof Error ? err.message : 'An error occurred while processing your request.';
      const errMsg: AIChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Error: ${errorContent}`,
        timestamp: Date.now(),
        context,
      };

      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, errMsg],
        aiIsThinking: false,
      }));
    }
  },

  requestAIReview: async (projectId) => {
    set({ aiIsThinking: true });
    try {
      const result = await workflowApi.requestAIReview(projectId);
      const msg: AIChatMessage = {
        id: `msg_${Date.now()}_review`,
        role: 'assistant',
        content: `Review complete! Score: ${result.score}/100. Found ${result.totalIssues} issue(s): ${result.criticalCount} critical, ${result.errorCount} errors, ${result.warningCount} warnings, ${result.infoCount} info.\n\n${result.summary}`,
        timestamp: Date.now(),
        context: 'review',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, msg],
        aiIsThinking: false,
      }));
      get().goToStage('review');
      get().setStageStatus('review', 'completed');
    } catch (err: unknown) {
      const errorContent = err instanceof Error ? err.message : 'Review failed.';
      const errMsg: AIChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Review error: ${errorContent}`,
        timestamp: Date.now(),
        context: 'review',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, errMsg],
        aiIsThinking: false,
      }));
      get().setStageStatus('review', 'error');
    }
  },

  requestAIPlacement: async (projectId) => {
    set({ aiIsThinking: true });
    try {
      const result = await workflowApi.requestAIPlacement(projectId);
      const msg: AIChatMessage = {
        id: `msg_${Date.now()}_place`,
        role: 'assistant',
        content: `AI placement complete! Generated ${result.suggestions.length} component placement suggestions with an estimated ${result.estimated_improvement.toFixed(0)}% improvement using the "${result.strategy}" strategy.\n\nReview the placement preview and accept or adjust individual components.`,
        timestamp: Date.now(),
        context: 'placement',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, msg],
        aiIsThinking: false,
      }));
      get().goToStage('placement');
    } catch (err: unknown) {
      const errorContent = err instanceof Error ? err.message : 'Placement failed.';
      const errMsg: AIChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Placement error: ${errorContent}`,
        timestamp: Date.now(),
        context: 'placement',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, errMsg],
        aiIsThinking: false,
      }));
      get().setStageStatus('placement', 'error');
    }
  },

  requestAIRouting: async (projectId) => {
    set({ aiIsThinking: true });
    try {
      const result = await workflowApi.requestAIRouting(projectId);
      const msg: AIChatMessage = {
        id: `msg_${Date.now()}_route`,
        role: 'assistant',
        content: `Routing strategy generated! ${result.routing_order.length} nets prioritized across ${Object.keys(result.layer_assignment).length} layer groups.\n\nReview the strategy and click "Execute Routing" when ready.`,
        timestamp: Date.now(),
        context: 'routing',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, msg],
        aiIsThinking: false,
      }));
      get().goToStage('routing');
    } catch (err: unknown) {
      const errorContent = err instanceof Error ? err.message : 'Routing strategy generation failed.';
      const errMsg: AIChatMessage = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Routing error: ${errorContent}`,
        timestamp: Date.now(),
        context: 'routing',
      };
      set((state) => ({
        aiChatMessages: [...state.aiChatMessages, errMsg],
        aiIsThinking: false,
      }));
      get().setStageStatus('routing', 'error');
    }
  },

  // -----------------------------------------------------------------------
  // UI toggles
  // -----------------------------------------------------------------------

  setAIPanelOpen: (open) => set({ aiPanelOpen: open }),
  toggleAIPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),

  setCrossProbe: (source, elementId) => set({ crossProbeSource: source, crossProbeElementId: elementId }),
  setSplitView: (enabled) => set({ splitViewEnabled: enabled }),

  resetWorkflow: () => set({
    currentStage: 'schematic',
    stages: DEFAULT_STAGES.map((s) => ({ ...s })),
    aiSuggestion: null,
    aiChatMessages: [],
    aiIsThinking: false,
    aiPanelOpen: false,
    overallProgress: 0,
    crossProbeSource: null,
    crossProbeElementId: null,
    splitViewEnabled: false,
  }),
}));
