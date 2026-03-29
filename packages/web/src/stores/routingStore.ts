import { create } from 'zustand';
import type {
  RoutingStrategy,
  RoutingProgressData,
  RoutingResultData,
  NetRoutingResult,
  PlacementResult,
  PlacementSuggestion,
} from '../api/routing';
import * as routingApi from '../api/routing';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

type RoutingPhase =
  | 'idle'
  | 'selecting_nets'
  | 'generating_strategy'
  | 'reviewing_strategy'
  | 'routing'
  | 'viewing_results'
  | 'error';

type PlacementPhase =
  | 'idle'
  | 'loading_suggestions'
  | 'viewing_suggestions'
  | 'applying'
  | 'error';

interface RoutingState {
  // Net selection
  selectedNets: Set<string>;
  naturalLanguageConstraints: string;

  // Strategy
  strategy: RoutingStrategy | null;
  strategyLoading: boolean;
  strategyError: string | null;

  // Routing progress
  phase: RoutingPhase;
  sessionId: string | null;
  progress: RoutingProgressData | null;
  pollIntervalId: ReturnType<typeof setInterval> | null;

  // Results
  results: RoutingResultData | null;
  acceptedNets: Set<string>;
  rejectedNets: Set<string>;

  // Placement
  placementPhase: PlacementPhase;
  placementResult: PlacementResult | null;
  placementError: string | null;
  appliedSuggestions: Set<string>;

  // Actions: net selection
  selectNet: (netId: string) => void;
  deselectNet: (netId: string) => void;
  selectAllNets: (netIds: string[]) => void;
  deselectAllNets: () => void;
  toggleNet: (netId: string) => void;
  setNaturalLanguageConstraints: (text: string) => void;

  // Actions: strategy
  generateStrategy: (projectId: string) => Promise<void>;
  setStrategy: (strategy: RoutingStrategy) => void;
  clearStrategy: () => void;

  // Actions: routing execution
  executeRouting: (projectId: string) => Promise<void>;
  cancelRouting: (projectId: string) => Promise<void>;
  startPolling: (projectId: string, sessionId: string) => void;
  stopPolling: () => void;
  updateProgress: (progress: RoutingProgressData) => void;
  fetchResults: (projectId: string) => Promise<void>;

  // Actions: results
  acceptNet: (netName: string) => void;
  rejectNet: (netName: string) => void;
  acceptAllNets: () => void;
  rejectAllNets: () => void;
  commitAccepted: (projectId: string) => Promise<void>;
  commitRejected: (projectId: string) => Promise<void>;
  undoRouting: (projectId: string) => Promise<void>;
  setResults: (results: RoutingResultData) => void;

  // Actions: placement
  loadPlacementSuggestions: (projectId: string, strategy: 'routing' | 'area' | 'thermal') => Promise<void>;
  applyPlacementSuggestion: (ref: string) => void;
  applyAllSuggestions: () => void;
  commitPlacement: (projectId: string) => Promise<void>;
  clearPlacement: () => void;

  // Actions: general
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Default progress (used as initial/reset value)
// ---------------------------------------------------------------------------

const defaultProgress: RoutingProgressData = {
  status: 'idle',
  total_nets: 0,
  completed_nets: 0,
  current_net: null,
  current_net_status: '',
  elapsed_seconds: 0,
  estimated_remaining_seconds: 0,
  completion_rate: 0,
  failed_nets: [],
  drc_violation_count: 0,
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRoutingStore = create<RoutingState>((set, get) => ({
  // Initial state
  selectedNets: new Set<string>(),
  naturalLanguageConstraints: '',
  strategy: null,
  strategyLoading: false,
  strategyError: null,
  phase: 'idle',
  sessionId: null,
  progress: null,
  pollIntervalId: null,
  results: null,
  acceptedNets: new Set<string>(),
  rejectedNets: new Set<string>(),
  placementPhase: 'idle',
  placementResult: null,
  placementError: null,
  appliedSuggestions: new Set<string>(),

  // -----------------------------------------------------------------------
  // Net selection
  // -----------------------------------------------------------------------

  selectNet: (netId: string) => {
    set((state) => {
      const next = new Set(state.selectedNets);
      next.add(netId);
      return { selectedNets: next, phase: 'selecting_nets' };
    });
  },

  deselectNet: (netId: string) => {
    set((state) => {
      const next = new Set(state.selectedNets);
      next.delete(netId);
      return {
        selectedNets: next,
        phase: next.size > 0 ? 'selecting_nets' : 'idle',
      };
    });
  },

  selectAllNets: (netIds: string[]) => {
    set({ selectedNets: new Set(netIds), phase: 'selecting_nets' });
  },

  deselectAllNets: () => {
    set({ selectedNets: new Set<string>(), phase: 'idle' });
  },

  toggleNet: (netId: string) => {
    const { selectedNets, selectNet, deselectNet } = get();
    if (selectedNets.has(netId)) {
      deselectNet(netId);
    } else {
      selectNet(netId);
    }
  },

  setNaturalLanguageConstraints: (text: string) => {
    set({ naturalLanguageConstraints: text });
  },

  // -----------------------------------------------------------------------
  // Strategy
  // -----------------------------------------------------------------------

  generateStrategy: async (projectId: string) => {
    const { selectedNets, naturalLanguageConstraints } = get();
    set({ strategyLoading: true, strategyError: null, phase: 'generating_strategy' });

    try {
      const res = await routingApi.generateStrategy(
        projectId,
        Array.from(selectedNets),
        naturalLanguageConstraints || undefined
      );
      set({
        strategy: res.data,
        strategyLoading: false,
        phase: 'reviewing_strategy',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate strategy';
      set({
        strategyLoading: false,
        strategyError: message,
        phase: 'error',
      });
    }
  },

  setStrategy: (strategy: RoutingStrategy) => {
    set({ strategy, phase: 'reviewing_strategy' });
  },

  clearStrategy: () => {
    set({ strategy: null, strategyError: null, phase: 'selecting_nets' });
  },

  // -----------------------------------------------------------------------
  // Routing execution
  // -----------------------------------------------------------------------

  executeRouting: async (projectId: string) => {
    const { strategy, selectedNets } = get();
    if (!strategy) return;

    set({ phase: 'routing', progress: { ...defaultProgress, status: 'routing' } });

    try {
      const res = await routingApi.executeRouting(
        projectId,
        strategy,
        Array.from(selectedNets)
      );
      const sessionId = res.data.session_id;
      set({ sessionId });
      get().startPolling(projectId, sessionId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to start routing';
      set({ phase: 'error', strategyError: message });
    }
  },

  cancelRouting: async (projectId: string) => {
    const { sessionId } = get();
    if (!sessionId) return;

    try {
      await routingApi.cancelRouting(projectId, sessionId);
      get().stopPolling();
      set((state) => ({
        phase: 'viewing_results',
        progress: state.progress
          ? { ...state.progress, status: 'cancelled' }
          : null,
      }));
    } catch {
      // If cancel fails, the polling will eventually detect completion
    }
  },

  startPolling: (projectId: string, sessionId: string) => {
    const { stopPolling } = get();
    stopPolling();

    const intervalId = setInterval(async () => {
      try {
        const res = await routingApi.getRoutingStatus(projectId, sessionId);
        const progress = res.data;
        get().updateProgress(progress);

        if (
          progress.status === 'completed' ||
          progress.status === 'failed' ||
          progress.status === 'cancelled'
        ) {
          get().stopPolling();
          if (progress.status === 'completed') {
            get().fetchResults(projectId);
          }
        }
      } catch {
        // Network error during polling - will retry on next interval
      }
    }, 1000);

    set({ pollIntervalId: intervalId });
  },

  stopPolling: () => {
    const { pollIntervalId } = get();
    if (pollIntervalId !== null) {
      clearInterval(pollIntervalId);
      set({ pollIntervalId: null });
    }
  },

  updateProgress: (progress: RoutingProgressData) => {
    set({ progress });
  },

  fetchResults: async (projectId: string) => {
    const { sessionId } = get();
    if (!sessionId) return;

    try {
      const res = await routingApi.getRoutingResults(projectId, sessionId);
      set({
        results: res.data,
        phase: 'viewing_results',
        acceptedNets: new Set<string>(),
        rejectedNets: new Set<string>(),
      });
    } catch {
      set({ phase: 'error', strategyError: 'Failed to fetch routing results' });
    }
  },

  // -----------------------------------------------------------------------
  // Results acceptance / rejection
  // -----------------------------------------------------------------------

  acceptNet: (netName: string) => {
    set((state) => {
      const accepted = new Set(state.acceptedNets);
      const rejected = new Set(state.rejectedNets);
      accepted.add(netName);
      rejected.delete(netName);
      return { acceptedNets: accepted, rejectedNets: rejected };
    });
  },

  rejectNet: (netName: string) => {
    set((state) => {
      const accepted = new Set(state.acceptedNets);
      const rejected = new Set(state.rejectedNets);
      rejected.add(netName);
      accepted.delete(netName);
      return { acceptedNets: accepted, rejectedNets: rejected };
    });
  },

  acceptAllNets: () => {
    const { results } = get();
    if (!results) return;
    const routed = results.net_results
      .filter((nr: NetRoutingResult) => nr.status === 'routed')
      .map((nr: NetRoutingResult) => nr.net_name);
    set({
      acceptedNets: new Set(routed),
      rejectedNets: new Set<string>(),
    });
  },

  rejectAllNets: () => {
    const { results } = get();
    if (!results) return;
    const routed = results.net_results
      .filter((nr: NetRoutingResult) => nr.status === 'routed')
      .map((nr: NetRoutingResult) => nr.net_name);
    set({
      rejectedNets: new Set(routed),
      acceptedNets: new Set<string>(),
    });
  },

  commitAccepted: async (projectId: string) => {
    const { sessionId, acceptedNets } = get();
    if (!sessionId || acceptedNets.size === 0) return;

    try {
      await routingApi.acceptNets(projectId, sessionId, Array.from(acceptedNets));
    } catch {
      set({ strategyError: 'Failed to commit accepted nets' });
    }
  },

  commitRejected: async (projectId: string) => {
    const { sessionId, rejectedNets } = get();
    if (!sessionId || rejectedNets.size === 0) return;

    try {
      await routingApi.rejectNets(projectId, sessionId, Array.from(rejectedNets));
    } catch {
      set({ strategyError: 'Failed to reject nets' });
    }
  },

  undoRouting: async (projectId: string) => {
    const { sessionId } = get();
    if (!sessionId) return;

    try {
      await routingApi.undoRouting(projectId, sessionId);
      set({
        results: null,
        progress: null,
        phase: 'reviewing_strategy',
        acceptedNets: new Set<string>(),
        rejectedNets: new Set<string>(),
      });
    } catch {
      set({ strategyError: 'Failed to undo routing' });
    }
  },

  setResults: (results: RoutingResultData) => {
    set({ results, phase: 'viewing_results' });
  },

  // -----------------------------------------------------------------------
  // Placement
  // -----------------------------------------------------------------------

  loadPlacementSuggestions: async (projectId: string, strategy: 'routing' | 'area' | 'thermal') => {
    set({ placementPhase: 'loading_suggestions', placementError: null });

    try {
      const res = await routingApi.getPlacementSuggestions(projectId, strategy);
      set({
        placementResult: res.data,
        placementPhase: 'viewing_suggestions',
        appliedSuggestions: new Set<string>(),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load placement suggestions';
      set({ placementPhase: 'error', placementError: message });
    }
  },

  applyPlacementSuggestion: (ref: string) => {
    set((state) => {
      const next = new Set(state.appliedSuggestions);
      if (next.has(ref)) {
        next.delete(ref);
      } else {
        next.add(ref);
      }
      return { appliedSuggestions: next };
    });
  },

  applyAllSuggestions: () => {
    const { placementResult } = get();
    if (!placementResult) return;
    const refs = placementResult.suggestions.map((s: PlacementSuggestion) => s.component_ref);
    set({ appliedSuggestions: new Set(refs) });
  },

  commitPlacement: async (projectId: string) => {
    const { placementResult, appliedSuggestions } = get();
    if (!placementResult || appliedSuggestions.size === 0) return;

    set({ placementPhase: 'applying' });
    try {
      await routingApi.applyPlacementSuggestions(
        projectId,
        placementResult.session_id,
        Array.from(appliedSuggestions)
      );
      set({ placementPhase: 'idle', placementResult: null, appliedSuggestions: new Set<string>() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to apply placement';
      set({ placementPhase: 'error', placementError: message });
    }
  },

  clearPlacement: () => {
    set({
      placementPhase: 'idle',
      placementResult: null,
      placementError: null,
      appliedSuggestions: new Set<string>(),
    });
  },

  // -----------------------------------------------------------------------
  // General
  // -----------------------------------------------------------------------

  reset: () => {
    const { stopPolling } = get();
    stopPolling();
    set({
      selectedNets: new Set<string>(),
      naturalLanguageConstraints: '',
      strategy: null,
      strategyLoading: false,
      strategyError: null,
      phase: 'idle',
      sessionId: null,
      progress: null,
      pollIntervalId: null,
      results: null,
      acceptedNets: new Set<string>(),
      rejectedNets: new Set<string>(),
      placementPhase: 'idle',
      placementResult: null,
      placementError: null,
      appliedSuggestions: new Set<string>(),
    });
  },
}));
