// ─── RouteAI EDA — Backend API Client ───────────────────────────────────────
// Communicates with the Python FastAPI backend for project operations,
// DRC, AI features, calculators, and export.

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const API_PREFIX = '/api/v1';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  detail?: string;
}

export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
}

export interface ProjectData {
  id: string;
  name: string;
  schematic: any;
  board: any;
  createdAt: string;
  updatedAt: string;
}

export interface DRCViolation {
  id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  description: string;
  x: number;
  y: number;
  layer?: string;
  netId?: string;
  elementIds?: string[];
}

export interface DRCResult {
  violations: DRCViolation[];
  score: number;
  runTime: number;
  timestamp: number;
}

export interface AIFinding {
  id: string;
  severity: 'critical' | 'warning' | 'suggestion' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation: string;
  affectedElements?: string[];
  x?: number;
  y?: number;
}

export interface AIReviewResult {
  findings: AIFinding[];
  summary: string;
  overallScore: number;
  model: string;
  processingTime: number;
}

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIChatResponse {
  message: AIChatMessage;
  model: string;
  tokensUsed: number;
}

export interface AIRoutingStrategy {
  strategy: string;
  priorityNets: string[];
  layerAssignment: Record<string, string>;
  suggestions: string[];
  estimatedViaCount: number;
  model: string;
}

export interface ImpedanceParams {
  traceWidth: number;
  dielectricHeight: number;
  dielectricConstant: number;
  copperThickness: number;
  type: 'microstrip' | 'stripline' | 'coplanar';
  gap?: number;
}

export interface ImpedanceResult {
  impedance: number;
  capacitancePerMm: number;
  inductancePerMm: number;
  propagationDelay: number;
  effectiveDielectric: number;
}

export interface CurrentParams {
  traceWidth: number;
  copperThickness: number;
  tempRise: number;
  ambientTemp: number;
  layer: 'internal' | 'external';
}

export interface CurrentResult {
  maxCurrent: number;
  resistance: number;
  voltageDrop: number;
  powerLoss: number;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  ollamaConnected: boolean;
  ollamaModel?: string;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

class ApiClient {
  private baseUrl: string;
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl + API_PREFIX;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    options?: { timeout?: number; requestId?: string; signal?: AbortSignal }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const timeout = options?.timeout ?? 30_000;

    // Cancel any previous request with the same ID
    if (options?.requestId) {
      this.abort(options.requestId);
      const controller = new AbortController();
      this.abortControllers.set(options.requestId, controller);
      options.signal = controller.signal;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    const signal = options?.signal
      ? anySignal([options.signal, controller.signal])
      : controller.signal;

    try {
      const headers: Record<string, string> = {};
      let fetchBody: BodyInit | undefined;

      if (body instanceof FormData) {
        fetchBody = body;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
      }

      const res = await fetch(url, {
        method,
        headers,
        body: fetchBody,
        signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        let detail: string | undefined;
        try {
          const errBody = await res.json();
          detail = errBody.detail || errBody.message;
        } catch {
          // ignore
        }
        const err: ApiError = {
          status: res.status,
          message: `HTTP ${res.status}: ${res.statusText}`,
          detail,
        };
        throw err;
      }

      // Handle blob responses (file downloads)
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/zip') || contentType.includes('application/octet-stream')) {
        return (await res.blob()) as unknown as T;
      }

      return await res.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw { status: 0, message: 'Request was cancelled or timed out' } as ApiError;
      }
      if (err.status !== undefined) {
        throw err; // Already an ApiError
      }
      throw {
        status: 0,
        message: 'Network error',
        detail: err.message || 'Failed to connect to backend',
      } as ApiError;
    } finally {
      if (options?.requestId) {
        this.abortControllers.delete(options.requestId);
      }
    }
  }

  /** Cancel an in-flight request by ID */
  abort(requestId: string): void {
    const controller = this.abortControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(requestId);
    }
  }

  // ── Health ──────────────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    return this.request<HealthStatus>('GET', '/health');
  }

  // ── Project ─────────────────────────────────────────────────────

  async uploadProject(file: File): Promise<ProjectData> {
    const form = new FormData();
    form.append('file', file);
    return this.request<ProjectData>('POST', '/project/upload', form, {
      timeout: 60_000,
      requestId: 'upload-project',
    });
  }

  async getProject(projectId: string): Promise<ProjectData> {
    return this.request<ProjectData>('GET', `/project/${projectId}`);
  }

  async saveProject(projectId: string, data: any): Promise<{ saved: boolean }> {
    return this.request('PUT', `/project/${projectId}`, data);
  }

  // ── DRC ─────────────────────────────────────────────────────────

  async runDRC(projectId: string): Promise<DRCResult> {
    return this.request<DRCResult>('POST', `/project/${projectId}/drc`, undefined, {
      timeout: 120_000,
      requestId: 'run-drc',
    });
  }

  // ── AI Features ─────────────────────────────────────────────────

  async aiReview(projectId: string): Promise<AIReviewResult> {
    return this.request<AIReviewResult>('POST', `/project/${projectId}/ai/review`, undefined, {
      timeout: 180_000,
      requestId: 'ai-review',
    });
  }

  async aiChat(projectId: string, message: string): Promise<AIChatResponse> {
    return this.request<AIChatResponse>('POST', `/project/${projectId}/ai/chat`, { message }, {
      timeout: 60_000,
      requestId: 'ai-chat',
    });
  }

  async aiRoutingStrategy(projectId: string): Promise<AIRoutingStrategy> {
    return this.request<AIRoutingStrategy>('POST', `/project/${projectId}/ai/routing-strategy`, undefined, {
      timeout: 120_000,
      requestId: 'ai-routing',
    });
  }

  // ── Calculators ─────────────────────────────────────────────────

  async calcImpedance(params: ImpedanceParams): Promise<ImpedanceResult> {
    return this.request<ImpedanceResult>('POST', '/calc/impedance', params);
  }

  async calcCurrent(params: CurrentParams): Promise<CurrentResult> {
    return this.request<CurrentResult>('POST', '/calc/current-capacity', params);
  }

  // ── Export ──────────────────────────────────────────────────────

  async exportGerber(projectId: string): Promise<Blob> {
    return this.request<Blob>('POST', `/project/${projectId}/export/gerber`, undefined, {
      timeout: 60_000,
      requestId: 'export-gerber',
    });
  }

  async exportBOM(projectId: string): Promise<Blob> {
    return this.request<Blob>('POST', `/project/${projectId}/export/bom`, undefined, {
      timeout: 30_000,
      requestId: 'export-bom',
    });
  }
}

// ─── Utility: combine abort signals ─────────────────────────────────────────

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

// ─── Singleton instance ─────────────────────────────────────────────────────

export const api = new ApiClient(BASE_URL);

// ─── React-friendly wrapper with loading/error states ───────────────────────

export function createApiCall<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<ApiResponse<TResult>> {
  return async (...args: TArgs): Promise<ApiResponse<TResult>> => {
    try {
      const data = await fn(...args);
      return { data, error: null, loading: false };
    } catch (err: any) {
      const apiErr: ApiError = err.status !== undefined
        ? err
        : { status: 0, message: err.message || 'Unknown error' };
      return { data: null, error: apiErr, loading: false };
    }
  };
}

// Pre-wrapped convenience functions
export const uploadProject = createApiCall((file: File) => api.uploadProject(file));
export const runDRC = createApiCall((projectId: string) => api.runDRC(projectId));
export const aiReview = createApiCall((projectId: string) => api.aiReview(projectId));
export const aiChat = createApiCall((projectId: string, message: string) => api.aiChat(projectId, message));
export const aiRoutingStrategy = createApiCall((projectId: string) => api.aiRoutingStrategy(projectId));
export const calcImpedance = createApiCall((params: ImpedanceParams) => api.calcImpedance(params));
export const calcCurrent = createApiCall((params: CurrentParams) => api.calcCurrent(params));
export const exportGerber = createApiCall((projectId: string) => api.exportGerber(projectId));

export default api;
