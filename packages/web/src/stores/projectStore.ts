import { create } from 'zustand';
import type { Project } from '../types/api';
import type { BoardData, Layer } from '../types/board';
import type { ReviewResult, ChatMessage } from '../types/review';
import * as projectsApi from '../api/projects';

interface ProjectState {
  // Project list
  projects: Project[];
  projectsLoading: boolean;
  totalProjects: number;

  // Current project
  currentProject: Project | null;
  boardData: BoardData | null;
  boardLoading: boolean;

  // Layer visibility
  layerVisibility: Record<string, boolean>;

  // Highlighted net
  highlightedNetId: string | null;

  // Selected element
  selectedElementId: string | null;
  selectedElementType: string | null;

  // Review
  reviewResult: ReviewResult | null;
  reviewLoading: boolean;

  // Chat
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  conversationId: string | null;

  // Viewer
  viewerCenter: { x: number; y: number } | null;
  viewerZoom: number;

  // Actions
  fetchProjects: (page?: number) => Promise<void>;
  fetchProject: (id: string) => Promise<void>;
  fetchBoardData: (id: string) => Promise<void>;
  uploadProject: (file: File, name: string, description?: string, onProgress?: (p: number) => void) => Promise<string>;
  deleteProject: (id: string) => Promise<void>;
  startReview: (projectId: string) => Promise<void>;
  fetchReview: (projectId: string, reviewId?: string) => Promise<void>;
  sendMessage: (projectId: string, message: string) => Promise<void>;
  setLayerVisibility: (layerId: string, visible: boolean) => void;
  toggleAllLayers: (visible: boolean) => void;
  setHighlightedNet: (netId: string | null) => void;
  setSelectedElement: (id: string | null, type: string | null) => void;
  navigateTo: (x: number, y: number, zoom?: number) => void;
  clearCurrentProject: () => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  projectsLoading: false,
  totalProjects: 0,
  currentProject: null,
  boardData: null,
  boardLoading: false,
  layerVisibility: {},
  highlightedNetId: null,
  selectedElementId: null,
  selectedElementType: null,
  reviewResult: null,
  reviewLoading: false,
  chatMessages: [],
  chatLoading: false,
  conversationId: null,
  viewerCenter: null,
  viewerZoom: 1,

  fetchProjects: async (page = 1) => {
    set({ projectsLoading: true });
    try {
      const res = await projectsApi.listProjects(page);
      set({ projects: res.data, totalProjects: res.total, projectsLoading: false });
    } catch {
      set({ projectsLoading: false });
    }
  },

  fetchProject: async (id: string) => {
    try {
      const res = await projectsApi.getProject(id);
      set({ currentProject: res.data });
    } catch {
      // handled by caller
    }
  },

  fetchBoardData: async (id: string) => {
    set({ boardLoading: true });
    try {
      const res = await projectsApi.getBoardData(id);
      const board = res.data;
      // Initialize layer visibility
      const visibility: Record<string, boolean> = {};
      board.layers.forEach((layer: Layer) => {
        visibility[layer.id] = layer.visible;
      });
      set({ boardData: board, layerVisibility: visibility, boardLoading: false });
    } catch {
      set({ boardLoading: false });
    }
  },

  uploadProject: async (file, name, description, onProgress) => {
    const res = await projectsApi.uploadProject(file, name, description, onProgress);
    // Refresh project list
    get().fetchProjects();
    return res.data.projectId;
  },

  deleteProject: async (id: string) => {
    await projectsApi.deleteProject(id);
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    }));
  },

  startReview: async (projectId: string) => {
    set({ reviewLoading: true });
    try {
      await projectsApi.startReview(projectId);
      // Review will be fetched via WebSocket or polling
    } catch {
      set({ reviewLoading: false });
    }
  },

  fetchReview: async (projectId: string, reviewId?: string) => {
    set({ reviewLoading: true });
    try {
      const res = await projectsApi.getReview(projectId, reviewId);
      set({ reviewResult: res.data ?? null, reviewLoading: false });
    } catch {
      set({ reviewResult: null, reviewLoading: false });
    }
  },

  sendMessage: async (projectId: string, message: string) => {
    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    set((state) => ({
      chatMessages: [...state.chatMessages, userMsg],
      chatLoading: true,
    }));

    try {
      const res = await projectsApi.sendChatMessage(projectId, message, get().conversationId);
      const payload = res.data;
      const msgId = payload.messageId || `assistant_${Date.now()}`;
      const assistantMsg: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: payload.content || (payload as unknown as { reply: string }).reply || '',
        timestamp: new Date().toISOString(),
        references: payload.references,
      };
      set((state) => ({
        chatMessages: [...state.chatMessages, assistantMsg],
        chatLoading: false,
        conversationId: state.conversationId || msgId,
      }));
    } catch {
      const errorMsg: ChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date().toISOString(),
      };
      set((state) => ({
        chatMessages: [...state.chatMessages, errorMsg],
        chatLoading: false,
      }));
    }
  },

  setLayerVisibility: (layerId: string, visible: boolean) => {
    set((state) => ({
      layerVisibility: { ...state.layerVisibility, [layerId]: visible },
    }));
  },

  toggleAllLayers: (visible: boolean) => {
    set((state) => {
      const vis: Record<string, boolean> = {};
      Object.keys(state.layerVisibility).forEach((k) => {
        vis[k] = visible;
      });
      return { layerVisibility: vis };
    });
  },

  setHighlightedNet: (netId: string | null) => {
    set({ highlightedNetId: netId });
  },

  setSelectedElement: (id: string | null, type: string | null) => {
    set({ selectedElementId: id, selectedElementType: type });
  },

  navigateTo: (x: number, y: number, zoom?: number) => {
    set({ viewerCenter: { x, y }, viewerZoom: zoom ?? get().viewerZoom });
  },

  clearCurrentProject: () => {
    set({
      currentProject: null,
      boardData: null,
      reviewResult: null,
      chatMessages: [],
      conversationId: null,
      highlightedNetId: null,
      selectedElementId: null,
      selectedElementType: null,
      layerVisibility: {},
    });
  },
}));
