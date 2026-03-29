import client from './client';
import type { ApiResponse } from '../types/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NetConstraints {
  max_length_mm: number | null;
  min_spacing_mm: number | null;
  impedance_ohm: number | null;
  length_match_group: string | null;
  max_vias: number | null;
  preferred_layers: string[];
}

export interface RoutingOrderEntry {
  net_name: string;
  priority: number;
  reason: string;
  constraints: NetConstraints;
}

export interface LayerAssignmentEntry {
  signal_layers: string[];
  reason: string;
}

export interface ViaStrategy {
  high_speed: string;
  general: string;
  power: string;
  return_path_via_max_distance_mm: number;
  via_size_overrides: Record<string, { drill_mm: number; pad_mm: number }>;
}

export interface CostWeights {
  wire_length: number;
  via_count: number;
  congestion: number;
  layer_change: number;
}

export interface GeneratedConstraint {
  type: string;
  description: string;
  affected_nets: string[];
  parameters: Record<string, unknown>;
}

export interface AdjustmentNote {
  change: string;
  reason: string;
  affected_nets: string[];
}

export interface RoutingStrategy {
  routing_order: RoutingOrderEntry[];
  layer_assignment: Record<string, LayerAssignmentEntry>;
  via_strategy: ViaStrategy;
  cost_weights: CostWeights;
  constraints_generated: GeneratedConstraint[];
  adjustment_notes: AdjustmentNote[];
  validation_passed: boolean;
  validation_errors: string[];
}

export interface RoutingProgressData {
  status: 'idle' | 'generating_strategy' | 'routing' | 'paused' | 'completed' | 'cancelled' | 'failed';
  total_nets: number;
  completed_nets: number;
  current_net: string | null;
  current_net_status: string;
  elapsed_seconds: number;
  estimated_remaining_seconds: number;
  completion_rate: number;
  failed_nets: string[];
  drc_violation_count: number;
}

export interface NetRoutingResult {
  net_name: string;
  status: 'routed' | 'failed' | 'skipped';
  length_mm: number;
  layers_used: string[];
  via_count: number;
  failure_reason?: string;
}

export interface RoutingResultData {
  session_id: string;
  completion_rate: number;
  total_nets: number;
  routed_count: number;
  failed_count: number;
  skipped_count: number;
  total_wire_length_mm: number;
  total_via_count: number;
  drc_violations: DrcViolation[];
  net_results: NetRoutingResult[];
  strategy_used: RoutingStrategy;
  iterations_used: number;
}

export interface DrcViolation {
  id: string;
  type: string;
  severity: 'error' | 'warning';
  description: string;
  location: { x: number; y: number };
  affected_nets: string[];
}

export interface PlacementSuggestion {
  component_ref: string;
  suggested_x: number;
  suggested_y: number;
  suggested_rotation: number;
  reason: string;
  citation: string;
  improvement_score: number;
}

export interface PlacementResult {
  session_id: string;
  suggestions: PlacementSuggestion[];
  strategy: string;
  estimated_improvement: number;
}

// ---------------------------------------------------------------------------
// Routing API calls
// ---------------------------------------------------------------------------

/** Generate an AI routing strategy for the project. */
export async function generateStrategy(
  projectId: string,
  selectedNets: string[],
  naturalLanguageConstraints?: string
): Promise<ApiResponse<RoutingStrategy>> {
  const { data } = await client.post<ApiResponse<RoutingStrategy>>(
    `/projects/${projectId}/routing/strategy`,
    { selected_nets: selectedNets, nl_constraints: naturalLanguageConstraints }
  );
  return data;
}

/** Execute routing with a given strategy. */
export async function executeRouting(
  projectId: string,
  strategy: RoutingStrategy,
  selectedNets: string[]
): Promise<ApiResponse<{ session_id: string }>> {
  const { data } = await client.post<ApiResponse<{ session_id: string }>>(
    `/projects/${projectId}/routing/execute`,
    { strategy, selected_nets: selectedNets }
  );
  return data;
}

/** Cancel an in-progress routing session. */
export async function cancelRouting(
  projectId: string,
  sessionId: string
): Promise<ApiResponse<void>> {
  const { data } = await client.post<ApiResponse<void>>(
    `/projects/${projectId}/routing/cancel`,
    { session_id: sessionId }
  );
  return data;
}

/** Poll for routing progress. */
export async function getRoutingStatus(
  projectId: string,
  sessionId: string
): Promise<ApiResponse<RoutingProgressData>> {
  const { data } = await client.get<ApiResponse<RoutingProgressData>>(
    `/projects/${projectId}/routing/status/${sessionId}`
  );
  return data;
}

/** Get the full results of a completed routing session. */
export async function getRoutingResults(
  projectId: string,
  sessionId: string
): Promise<ApiResponse<RoutingResultData>> {
  const { data } = await client.get<ApiResponse<RoutingResultData>>(
    `/projects/${projectId}/routing/results/${sessionId}`
  );
  return data;
}

/** Accept specific routed nets (commit them to the board). */
export async function acceptNets(
  projectId: string,
  sessionId: string,
  netNames: string[]
): Promise<ApiResponse<void>> {
  const { data } = await client.post<ApiResponse<void>>(
    `/projects/${projectId}/routing/accept`,
    { session_id: sessionId, net_names: netNames }
  );
  return data;
}

/** Reject specific routed nets (discard the routing). */
export async function rejectNets(
  projectId: string,
  sessionId: string,
  netNames: string[]
): Promise<ApiResponse<void>> {
  const { data } = await client.post<ApiResponse<void>>(
    `/projects/${projectId}/routing/reject`,
    { session_id: sessionId, net_names: netNames }
  );
  return data;
}

/** Undo routing - restore the board to its pre-routing state. */
export async function undoRouting(
  projectId: string,
  sessionId: string
): Promise<ApiResponse<void>> {
  const { data } = await client.post<ApiResponse<void>>(
    `/projects/${projectId}/routing/undo`,
    { session_id: sessionId }
  );
  return data;
}

// ---------------------------------------------------------------------------
// Placement API calls
// ---------------------------------------------------------------------------

/** Run auto-placement with a given strategy. */
export async function autoPlace(
  projectId: string,
  strategy: 'routing' | 'area' | 'thermal'
): Promise<ApiResponse<PlacementResult>> {
  const { data } = await client.post<ApiResponse<PlacementResult>>(
    `/projects/${projectId}/placement/auto`,
    { strategy }
  );
  return data;
}

/** Get AI placement suggestions without applying them. */
export async function getPlacementSuggestions(
  projectId: string,
  strategy: 'routing' | 'area' | 'thermal'
): Promise<ApiResponse<PlacementResult>> {
  const { data } = await client.post<ApiResponse<PlacementResult>>(
    `/projects/${projectId}/placement/suggestions`,
    { strategy }
  );
  return data;
}

/** Apply specific placement suggestions. */
export async function applyPlacementSuggestions(
  projectId: string,
  sessionId: string,
  componentRefs: string[]
): Promise<ApiResponse<void>> {
  const { data } = await client.post<ApiResponse<void>>(
    `/projects/${projectId}/placement/apply`,
    { session_id: sessionId, component_refs: componentRefs }
  );
  return data;
}
