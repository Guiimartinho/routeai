/**
 * API client for the end-to-end design workflow.
 *
 * Covers AI chat, placement, review, routing, export, cross-probe,
 * and DRC endpoints.
 */

import axios from 'axios';
import type { ApiResponse } from '../types/api';
import type { ReviewResult, BoardReference } from '../types/review';
import type { PlacementResult, RoutingStrategy } from './routing';

// Auth interceptor shared by all clients
function attachAuth(config: import('axios').InternalAxiosRequestConfig) {
  const token = localStorage.getItem('routeai_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}

// Dedicated client for workflow endpoints (backend router prefix: /api/workflow)
const workflowClient = axios.create({
  baseURL: '/api/workflow',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});
workflowClient.interceptors.request.use(attachAuth);

// Client for /api-prefixed endpoints (AI chat, etc.)
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});
apiClient.interceptors.request.use(attachAuth);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AIChatResult {
  messageId: string;
  content: string;
  references?: BoardReference[];
}

export interface CrossProbeResult {
  source: 'schematic' | 'board';
  elementId: string;
  matchedElementId: string | null;
  matchedType: 'component' | 'net' | 'pin' | null;
  location: { x: number; y: number } | null;
  highlightIds: string[];
}

export interface DrcResult {
  passed: boolean;
  totalViolations: number;
  errors: number;
  warnings: number;
  violations: DrcViolationItem[];
}

export interface DrcViolationItem {
  id: string;
  type: string;
  severity: 'error' | 'warning';
  description: string;
  location: { x: number; y: number };
  affectedNets: string[];
  autoFixAvailable: boolean;
}

export type ExportFormat = 'kicad' | 'eagle' | 'gerber' | 'odb' | 'bom' | 'pnp' | 'step';

export interface ExportFormatInfo {
  id: ExportFormat;
  name: string;
  extension: string;
  description: string;
  category: 'design' | 'manufacturing' | 'data' | '3d';
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'kicad', name: 'KiCad', extension: '.kicad_pcb + .kicad_sch', description: 'Native KiCad project files', category: 'design' },
  { id: 'eagle', name: 'Eagle', extension: '.brd + .sch', description: 'Autodesk Eagle board and schematic', category: 'design' },
  { id: 'gerber', name: 'Gerber (RS-274X)', extension: '.gbr (zip)', description: 'Industry-standard fabrication format', category: 'manufacturing' },
  { id: 'odb', name: 'ODB++', extension: '.odb (zip)', description: 'Comprehensive manufacturing data package', category: 'manufacturing' },
  { id: 'bom', name: 'Bill of Materials', extension: '.csv', description: 'Component list with quantities and values', category: 'data' },
  { id: 'pnp', name: 'Pick & Place', extension: '.csv', description: 'Component positions for SMT assembly', category: 'data' },
  { id: 'step', name: '3D Model (STEP)', extension: '.step', description: '3D mechanical model for enclosure design', category: '3d' },
];

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/** Send a contextual AI chat message (backend: /api/projects/{id}/ai/chat). */
export async function sendAIChat(
  projectId: string,
  message: string,
  context: string,
): Promise<AIChatResult> {
  const { data } = await apiClient.post<ApiResponse<AIChatResult>>(
    `/projects/${projectId}/ai/chat`,
    { message, context },
  );
  return data.data;
}

/** Request an AI-powered design review (backend: /api/workflow/{id}/ai-review). */
export async function requestAIReview(
  projectId: string,
): Promise<ReviewResult> {
  const { data } = await workflowClient.post<ApiResponse<ReviewResult>>(
    `/${projectId}/ai-review`,
  );
  return data.data;
}

/** Request AI component placement (backend: /api/workflow/{id}/ai-placement). */
export async function requestAIPlacement(
  projectId: string,
  boardSize?: { width: number; height: number },
  layerCount?: number,
): Promise<PlacementResult> {
  const { data } = await workflowClient.post<ApiResponse<PlacementResult>>(
    `/${projectId}/ai-placement`,
    { board_size: boardSize, layer_count: layerCount },
  );
  return data.data;
}

/** Request AI routing strategy generation (backend: /api/workflow/{id}/ai-routing). */
export async function requestAIRouting(
  projectId: string,
): Promise<RoutingStrategy> {
  const { data } = await workflowClient.post<ApiResponse<RoutingStrategy>>(
    `/${projectId}/ai-routing`,
  );
  return data.data;
}

/** Run full DRC check.
 *  TODO: No standalone DRC endpoint exists on the backend yet.
 *  DRC is currently run as part of ai-review. This is a placeholder
 *  for when a dedicated DRC endpoint is added.
 */
export async function runDrc(
  projectId: string,
): Promise<DrcResult> {
  const { data } = await workflowClient.post<ApiResponse<DrcResult>>(
    `/${projectId}/ai-review`,
  );
  return data.data;
}

/** Export project in a given format. Returns a downloadable blob.
 *  Backend: POST /api/workflow/{id}/export/{format}
 */
export async function exportProject(
  projectId: string,
  format: ExportFormat,
): Promise<Blob> {
  const { data } = await workflowClient.post(
    `/${projectId}/export/${format}`,
    {},
    { responseType: 'blob' },
  );
  return data;
}

/** Cross-probe: look up a matching element across schematic/board.
 *  Backend: GET /api/workflow/{id}/cross-probe?source=...&element_id=...
 */
export async function crossProbe(
  projectId: string,
  source: 'schematic' | 'board',
  elementId: string,
): Promise<CrossProbeResult> {
  const { data } = await workflowClient.get<ApiResponse<CrossProbeResult>>(
    `/${projectId}/cross-probe`,
    { params: { source, element_id: elementId } },
  );
  return data.data;
}
