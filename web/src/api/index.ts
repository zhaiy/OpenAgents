const API_BASE = '/api';

// =============================================================================
// Unified API Error Types - Aligned with backend DTO
// =============================================================================

export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'CONFLICT';

export interface ApiErrorDetail {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  error: ApiErrorDetail;
}

// API Error class for structured error handling
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: ApiErrorCode,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  let url = `${API_BASE}${path}`;

  // Append query params if provided
  if (options?.params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined) {
        searchParams.set(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const headers = new Headers(options?.headers);
  if (!headers.has('Content-Type') && !(options?.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    let errorCode: ApiErrorCode | undefined;
    let errorDetails: unknown;

    try {
      const errorBody = await res.json() as ApiErrorResponse;
      if (errorBody.error) {
        errorMessage = errorBody.error.message;
        errorCode = errorBody.error.code;
        errorDetails = errorBody.error.details;
      }
    } catch {
      // Use default message
    }

    throw new ApiError(errorMessage, res.status, errorCode, errorDetails);
  }

  // Handle empty responses
  const text = await res.text();
  if (!text) return {} as T;

  return JSON.parse(text) as T;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  hasGate: boolean;
  hasEval: boolean;
}

export interface RunSummary {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  stepCount: number;
  completedStepCount: number;
  score?: number;
  /** Information about the run this was recovered from, if any */
  recoveredFrom?: {
    runId: string;
    recoveredAt: number;
    reusedStepIds: string[];
    rerunStepIds: string[];
  };
}

export interface RunDetail {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  input: string;
  inputData?: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  steps: Step[];
  /** Information about the run this was recovered from, if any */
  recoveredFrom?: {
    runId: string;
    recoveredAt: number;
    reusedStepIds: string[];
    rerunStepIds: string[];
  };
  /** Cost summary identifying high-cost steps (M5) */
  costSummary?: RunCostSummary;
}

export interface Step {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'gate_waiting';
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  output?: string;
  error?: string;
  tokenUsage?: TokenUsage;
}

// =============================================================================
// Cost Observation Types (M5)
// =============================================================================

export interface StepCostInfo {
  stepId: string;
  name: string;
  tokens?: number;
  durationMs?: number;
  percentTokens?: number;
  percentDuration?: number;
}

export interface RunCostSummary {
  totalTokens?: number;
  totalDurationMs?: number;
  topTokensSteps: StepCostInfo[];
  topDurationSteps: StepCostInfo[];
  avgTokensPerStep?: number;
  avgDurationMsPerStep?: number;
}

// =============================================================================
// Quality Observation Types (M6)
// =============================================================================

export interface QualityRunSummary {
  runId: string;
  status: 'completed' | 'failed' | 'running' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  errorType?: string;
}

export interface FailureTypeDistribution {
  errorType: string;
  count: number;
  percentage: number;
}

export interface GateWaitStats {
  totalGateWaits: number;
  runsWithGateWait: number;
  lastGateWaitAt?: number;
}

export interface EvalSummary {
  runsWithEval: number;
  avgScore?: number;
  lastScore?: number;
  trend?: 'improving' | 'declined' | 'stable' | 'insufficient_data';
}

export interface WorkflowQualitySummary {
  workflowId: string;
  workflowName?: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  activeCount: number;
  successRate: number;
  failureRate: number;
  avgDurationMs?: number;
  gateWaitStats: GateWaitStats;
  failureTypes: FailureTypeDistribution[];
  evalSummary?: EvalSummary;
  recentRuns: QualityRunSummary[];
  computedAt: number;
}

export interface RunEvent {
  type: string;
  runId: string;
  stepId?: string;
  chunk?: string;
  ts: number;
  [key: string]: unknown;
}

export interface Settings {
  projectPath: string;
  locale: string;
  theme: 'light' | 'dark' | 'system';
  apiKeyConfigured: boolean;
  baseUrlConfigured: boolean;
}

export interface RunStartRequest {
  workflowId: string;
  input?: string;
  inputData?: Record<string, unknown>;
  stream?: boolean;
  autoApprove?: boolean;
  noEval?: boolean;
}

export interface RunStartResponse {
  runId: string;
  status: string;
}

export interface GateActionRequest {
  action: 'approve' | 'reject' | 'edit';
  editedOutput?: string;
}

// =============================================================================
// Visual DTOs for v6 - copied from backend for frontend use
// =============================================================================

export type NodeStatus = 'pending' | 'queued' | 'running' | 'streaming' | 'gate_waiting' | 'completed' | 'failed' | 'skipped' | 'cached';

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
}

export interface WorkflowVisualNode {
  id: string;
  name: string;
  type: 'agent' | 'gate' | 'eval' | 'script' | 'start' | 'end';
  agentId?: string;
  hasGate: boolean;
  hasEval: boolean;
  isCachedCapable: boolean;
  upstreamIds: string[];
  downstreamIds: string[];
  description?: string;
}

export interface WorkflowVisualEdge {
  id: string;
  source: string;
  target: string;
  type?: 'default' | 'gate' | 'conditional';
}

export interface InputSchemaField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface InputSchemaSummary {
  fields: InputSchemaField[];
  totalFields: number;
  requiredFields: number;
}

export interface WorkflowVisualSummary {
  workflowId: string;
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  gateCount: number;
  evalCount: number;
  visualNodes: WorkflowVisualNode[];
  visualEdges: WorkflowVisualEdge[];
  inputSchemaSummary?: InputSchemaSummary;
}

export interface RunNodeState {
  nodeId: string;
  status: NodeStatus;
  inputPreview?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  outputPreview?: string;
  logSummary?: string;
  errorMessage?: string;
  gateState?: {
    type: 'waiting' | 'approved' | 'rejected' | 'edited';
    preview?: string;
  };
  tokenUsage?: TokenUsage;
  retryCount?: number;
}

export interface RunVisualState {
  runId: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  nodeStates: Record<string, RunNodeState>;
  currentActiveNodeIds: string[];
  gateWaitingNodeIds: string[];
  failedNodeIds: string[];
  tokenUsage?: TokenUsage;
  version: number;
  lastEventId?: string;
}

export interface TimelineEntry {
  id: string;
  event: string;
  timestamp: number;
  stepId?: string;
  details?: string;
  status?: 'success' | 'error' | 'warning' | 'info';
}

// SSE Sync Event payload
export interface SSESyncEvent {
  type: 'sync';
  runId: string;
  visualState?: RunVisualState;
  sequence?: number;
  lastSequence?: number;
  ts: number;
}

export interface ConfigDraft {
  draftId: string;
  workflowId: string;
  name: string;
  inputData: Record<string, unknown>;
  runtimeOptions?: {
    stream?: boolean;
    autoApprove?: boolean;
    noEval?: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// Comparison Types (N7 Enhancement)
// =============================================================================

export type InputDiffType = 'added' | 'removed' | 'changed' | 'type_changed';

export interface InputDiff {
  field: string;
  valueA: unknown;
  valueB: unknown;
  diffType: InputDiffType;
  typeA?: string;
  typeB?: string;
}

export interface NodeStatusDiff {
  nodeId: string;
  statusA: NodeStatus;
  statusB: NodeStatus;
  durationDiff?: {
    runA?: number;
    runB?: number;
    delta?: number;
  };
  errorA?: string;
  errorB?: string;
  isCritical?: boolean;
}

export interface DurationDiff {
  runA: number;
  runB: number;
  delta: number;
  percentChange?: number;
}

export interface OutputDiffItem {
  nodeId: string;
  hasOutputA: boolean;
  hasOutputB: boolean;
  previewA?: string;
  previewB?: string;
  isIdentical: boolean;
}

export interface ComparisonSummary {
  similarityScore: number;
  keyDifferences: string[];
  recommendations: string[];
  warnings: string[];
  versionDiffSummary?: {
    hasConfigDiff: boolean;
    structuralChanges: number;
    configChanges: number;
    changeDescription: string;
    impactAssessment: string;
  };
}

export type ChangeImpactType = 'execution_path' | 'output_risk' | 'both';

export interface NodeConfigDiff {
  nodeId: string;
  nodeName?: string;
  impactType: ChangeImpactType;
  agentChanged?: { runA: string; runB: string };
  modelChanged?: { runA?: string; runB?: string };
  promptChanged?: { runA: string; runB: string; isSignificant: boolean };
  taskChanged?: { runA: string; runB: string };
  dependenciesChanged?: { runA: string[]; runB: string[]; added: string[]; removed: string[] };
  gateChanged?: { runA?: 'auto' | 'approve'; runB?: 'auto' | 'approve' };
}

export interface WorkflowConfigDiff {
  isSameConfig: boolean;
  versionHashA?: string;
  versionHashB?: string;
  structureDiff?: {
    addedNodes: string[];
    removedNodes: string[];
    reorderedNodes?: string[];
  };
  nodeDiffs: NodeConfigDiff[];
  summary: {
    totalChanges: number;
    executionPathChanges: number;
    outputRiskChanges: number;
  };
}

export interface RunComparison {
  runAId: string;
  runBId: string;
  workflowInfo?: {
    workflowId: string;
    name: string;
    isSameWorkflow: boolean;
  };
  workflowConfigDiff?: WorkflowConfigDiff;
  inputDiff?: InputDiff[];
  inputDiffSummary?: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  statusDiff: { runA: string; runB: string };
  nodeStatusDiff?: NodeStatusDiff[];
  nodeDiffSummary?: {
    totalNodes: number;
    identical: number;
    different: number;
    onlyInA: number;
    onlyInB: number;
  };
  durationDiff?: DurationDiff;
  tokenUsageDiff?: {
    runA: TokenUsage;
    runB: TokenUsage;
    delta?: number;
    percentChange?: number;
  };
  outputDiff?: OutputDiffItem[];
  summary: ComparisonSummary;
}

export interface RunComparisonSession {
  sessionId: string;
  createdAt: number;
  ttl: number;
  expiresAt: number;
  comparison: RunComparison;
}

export const workflowApi = {
  list: () => request<Workflow[]>('/workflows'),
  get: (workflowId: string) => request<Workflow>(`/workflows/${encodeURIComponent(workflowId)}`),
};

export const runApi = {
  start: (body: RunStartRequest) =>
    request<RunStartResponse>('/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  list: (filters?: { status?: string; workflowId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.workflowId) params.set('workflowId', filters.workflowId);
    const query = params.toString();
    return request<RunSummary[]>(`/runs${query ? `?${query}` : ''}`);
  },
  get: (runId: string) => request<RunDetail>(`/runs/${encodeURIComponent(runId)}`),
  getEvents: (runId: string) => request<RunEvent[]>(`/runs/${encodeURIComponent(runId)}/events`),
  getStepOutput: (runId: string, stepId: string) =>
    request<string>(`/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/output`),
  getEval: (runId: string) => request<Record<string, unknown>>(`/runs/${encodeURIComponent(runId)}/eval`),
  resume: (runId: string) => request<RunStartResponse>(`/runs/${encodeURIComponent(runId)}/resume`, { method: 'POST' }),
  gateAction: (runId: string, stepId: string, body: GateActionRequest) =>
    request<{ success: boolean }>(`/runs/${encodeURIComponent(runId)}/gates/${encodeURIComponent(stepId)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  rerun: (runId: string) =>
    request<RunStartResponse>(`/runs/${encodeURIComponent(runId)}/rerun`, { method: 'POST' }),
  rerunWithEdits: (runId: string, inputData: Record<string, unknown>, runtimeOptions?: RuntimeOptions) =>
    request<RunStartResponse>(`/runs/${encodeURIComponent(runId)}/rerun-with-edits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputData, runtimeOptions }),
    }),
  getReusableConfig: (runId: string) =>
    request<ReusableConfig>(`/runs/${encodeURIComponent(runId)}/reusable-config`),
  getRerunPreview: (runId: string, edits?: { inputData?: Record<string, unknown>; runtimeOptions?: RuntimeOptions }) =>
    request<RerunPreview>(`/runs/${encodeURIComponent(runId)}/rerun-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edits || {}),
    }),
  // Recovery API (M1 - Node-Level Recovery)
  getRecoveryPreview: (runId: string, options?: { resumeFromStep?: string; reuseSteps?: string[]; forceRerunSteps?: string[] }) => {
    const params = new URLSearchParams();
    if (options?.resumeFromStep) params.set('resumeFromStep', options.resumeFromStep);
    if (options?.reuseSteps?.length) params.set('reuseSteps', options.reuseSteps.join(','));
    if (options?.forceRerunSteps?.length) params.set('forceRerunSteps', options.forceRerunSteps.join(','));
    const query = params.toString();
    return request<RecoveryPreview>(
      `/runs/${encodeURIComponent(runId)}/recovery-preview${query ? `?${query}` : ''}`
    );
  },
  recover: (runId: string, recoveryRequest: RecoveryRequest) =>
    request<RecoveryResult>(`/runs/${encodeURIComponent(runId)}/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recoveryRequest),
    }),
};

// Rerun types - aligned with backend DTO
export interface RuntimeOptions {
  stream?: boolean;
  autoApprove?: boolean;
  noEval?: boolean;
}

export interface ReusableConfig {
  runId: string;
  workflowId: string;
  workflowName?: string;
  input: string;
  inputData: Record<string, unknown>;
  runtimeOptions: RuntimeOptions;
  runStatus: 'completed' | 'failed' | 'interrupted';
  startedAt: number;
  durationMs?: number;
}

export interface InputDiffItem {
  field: string;
  original?: unknown;
  new?: unknown;
  type: 'added' | 'removed' | 'changed';
}

export interface RerunPreview {
  sourceRun: {
    runId: string;
    status: 'completed' | 'failed' | 'interrupted';
    startedAt: number;
    durationMs?: number;
  };
  workflow: {
    workflowId: string;
    name: string;
    stepCount: number;
    hasGate: boolean;
  };
  inputDiff?: InputDiffItem[];
  runtimeOptionsDiff?: Array<{
    field: 'stream' | 'autoApprove' | 'noEval';
    original: boolean;
    new: boolean;
  }>;
  warnings?: string[];
}

// =============================================================================
// Recovery Types (M1 - Node-Level Recovery)
// =============================================================================

export type StepStatus = 'pending' | 'running' | 'gate_waiting' | 'completed' | 'failed' | 'interrupted' | 'skipped';

export type RecoverableStepType = 'reused' | 'rerun' | 'invalidated' | 'at_risk';

export interface RecoveryStepPreview {
  stepId: string;
  stepName?: string;
  currentStatus: StepStatus;
  recoveryAction: RecoverableStepType;
  reason: string;
}

export interface RecoveryImpactWarning {
  stepId: string;
  stepName?: string;
  impactType: 'gate_reset' | 'eval_reset' | 'output_invalidated' | 'blocked';
  description: string;
}

export interface RecoveryPreview {
  sourceRun: {
    runId: string;
    status: 'failed';
    failedAt: number;
    failedNodeIds: string[];
  };
  workflow: {
    workflowId: string;
    name: string;
    stepCount: number;
  };
  reusedSteps: RecoveryStepPreview[];
  rerunSteps: RecoveryStepPreview[];
  invalidatedSteps: RecoveryStepPreview[];
  atRiskSteps: RecoveryStepPreview[];
  warnings: RecoveryImpactWarning[];
  riskLevel: 'low' | 'medium' | 'high';
  summary: string;
}

export interface RecoveryRequest {
  sourceRunId: string;
  resumeFromStep?: string;
  reuseSteps?: string[];
  forceRerunSteps?: string[];
  inputData?: Record<string, unknown>;
  runtimeOptions?: RuntimeOptions;
}

export interface RecoveryResult {
  newRunId: string;
  sourceRunId: string;
  status: 'running';
  reusedStepIds: string[];
  rerunStepIds: string[];
}

export const settingsApi = {
  get: () => request<Settings>('/settings'),
};

// Visual API methods
export const visualApi = {
  // Workflow Visual Summary
  getWorkflowSummary: (workflowId: string) =>
    request<WorkflowVisualSummary>(`/workflows/${encodeURIComponent(workflowId)}/visual-summary`),

  // Run Visual State
  getRunVisualState: (runId: string) =>
    request<RunVisualState>(`/runs/${encodeURIComponent(runId)}/visual-state`),

  // Run Timeline
  getRunTimeline: (runId: string) =>
    request<TimelineEntry[]>(`/runs/${encodeURIComponent(runId)}/timeline`),

  // Run Node State
  getNodeState: (runId: string, nodeId: string) =>
    request<RunNodeState>(`/runs/${encodeURIComponent(runId)}/nodes/${encodeURIComponent(nodeId)}`),

  // Reusable Config
  getReusableConfig: (runId: string) =>
    request<{ workflowId: string; input: string; inputData: Record<string, unknown>; runtimeOptions: unknown }>(
      `/runs/${encodeURIComponent(runId)}/reusable-config`
    ),
};

// Draft API methods
export const draftApi = {
  list: (workflowId: string) =>
    request<ConfigDraft[]>(`/workflows/${encodeURIComponent(workflowId)}/drafts`),
  get: (workflowId: string, draftId: string) =>
    request<ConfigDraft>(`/workflows/${encodeURIComponent(workflowId)}/drafts/${encodeURIComponent(draftId)}`),
  create: (workflowId: string, body: { name: string; inputData: Record<string, unknown>; runtimeOptions?: unknown }) =>
    request<ConfigDraft>(`/workflows/${encodeURIComponent(workflowId)}/drafts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (workflowId: string, draftId: string, body: Partial<{ name: string; inputData: Record<string, unknown>; runtimeOptions?: unknown }>) =>
    request<ConfigDraft>(`/workflows/${encodeURIComponent(workflowId)}/drafts/${encodeURIComponent(draftId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  delete: (workflowId: string, draftId: string) =>
    request<void>(`/workflows/${encodeURIComponent(workflowId)}/drafts/${encodeURIComponent(draftId)}`, {
      method: 'DELETE',
    }),
};

// Diagnostics types - aligned with backend DTO
export interface FailedNodeDetail {
  nodeId: string;
  nodeName?: string;
  status: 'failed';
  errorType: string;
  errorMessage: string;
  failedAt?: number;
  retryCount?: number;
  upstreamCompleted: string[];
  upstreamFailed: string[];
}

export interface DownstreamImpactNode {
  nodeId: string;
  nodeName?: string;
  status: NodeStatus;
  impactType: 'blocked' | 'skipped' | 'will_fail';
  reason: string;
}

export interface FailurePropagation {
  rootCauseNodeId: string;
  propagationPath: string[];
  affectedNodeCount: number;
  summary: string;
}

export interface RecommendedAction {
  type: 'rerun' | 'rerun_with_edits' | 'recover' | 'fix_config' | 'check_api' | 'retry' | 'contact_support';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  targetNodeId?: string;
  targetRunId?: string;
}

export interface DiagnosticsSummary {
  runId: string;
  workflowId: string;
  workflowName?: string;
  runStatus: 'running' | 'completed' | 'failed' | 'interrupted';
  failedNodeIds: string[];
  gateWaitingNodeIds: string[];
  failedNodes: FailedNodeDetail[];
  downstreamImpact: DownstreamImpactNode[];
  failurePropagation?: FailurePropagation;
  errorSummary: Array<{ nodeId: string; errorType: string; errorMessage: string; suggestedActions: string[] }>;
  upstreamStates: Record<string, NodeStatus>;
  recommendedActions: RecommendedAction[];
  /** Recovery scope preview for failed runs - computed from dependency analysis */
  recoveryScope?: {
    reusedCount: number;
    rerunCount: number;
    invalidatedCount: number;
    riskLevel: 'low' | 'medium' | 'high';
    summary: string;
  };
  /** E4: Structured failure recap summary */
  failureRecap?: {
    summary: string;
    primaryErrorType: string;
    totalAffectedNodes: number;
    blocksExecution: boolean;
    insight: string;
  };
  /** E4: Source run info if this was a recovery/rerun */
  sourceRunInfo?: {
    sourceRunId: string;
    relationship: 'recover' | 'rerun' | 'rerun_with_edits';
    reusedStepCount: number;
    rerunStepCount: number;
  };
}

// Diagnostics API methods
export const diagnosticsApi = {
  getFailedRuns: () =>
    request<Array<{ runId: string; workflowId: string; failedAt: number; failedNodeId?: string; errorType?: string; errorMessage?: string }>>(
      '/diagnostics/failed-runs'
    ),
  getWaitingGates: () =>
    request<Array<{ runId: string; workflowId: string; stepId: string; waitedAt: number; preview?: string }>>(
      '/diagnostics/waiting-gates'
    ),
  getRunDiagnostics: (runId: string) =>
    request<DiagnosticsSummary>(`/diagnostics/runs/${encodeURIComponent(runId)}`),
  getWorkflowQualitySummary: (workflowId: string, limit?: number) =>
    request<WorkflowQualitySummary>(`/diagnostics/workflows/${encodeURIComponent(workflowId)}/quality`, {
      params: { limit },
    }),
  listWorkflowQualitySummaries: (limit?: number) =>
    request<WorkflowQualitySummary[]>('/diagnostics/quality-summaries', {
      params: { limit },
    }),
};

// Comparison API
export const comparisonApi = {
  compare: (runAId: string, runBId: string) =>
    request<RunComparison>(`/runs/compare?runA=${encodeURIComponent(runAId)}&runB=${encodeURIComponent(runBId)}`),
  createSession: (runAId: string, runBId: string) =>
    request<RunComparisonSession>('/compare', {
      method: 'POST',
      body: JSON.stringify({ runAId, runBId }),
    }),
  getSession: (sessionId: string) =>
    request<RunComparisonSession>(`/compare/${encodeURIComponent(sessionId)}`),
  deleteSession: (sessionId: string) =>
    request<void>(`/compare/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
};

export interface SSEOptions {
  /** Maximum retry attempts (default: 5) */
  maxRetries?: number;
  /** Initial retry delay in ms (default: 1000) */
  retryDelayMs?: number;
  /** Maximum retry delay in ms (default: 30000) */
  maxRetryDelayMs?: number;
  /** Callback when connection status changes */
  onStatusChange?: (status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting') => void;
  /** Last event ID for reconnection */
  lastEventId?: string;
}

/**
 * Enhanced SSE connection with reconnection strategy.
 *
 * Supports:
 * - Sequence-based event ordering via Last-Event-ID header
 * - Visual state recovery on reconnection
 * - Exponential backoff with configurable max retries
 * - Connection status callbacks
 */
export function createSSEConnection(
  runId: string,
  onMessage: (event: RunEvent, eventId?: string) => void,
  onError?: (error?: Error, retryCount?: number) => void,
  options: SSEOptions = {}
) {
  const {
    maxRetries = 5,
    retryDelayMs = 1000,
    maxRetryDelayMs = 30000,
    onStatusChange,
    lastEventId,
  } = options;

  let retryCount = 0;
  let es: EventSource | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let currentLastEventId = lastEventId;

  const updateStatus = (status: 'connecting' | 'connected' | 'disconnected' | 'error' | 'reconnecting') => {
    onStatusChange?.(status);
  };

  const handleIncoming = (e: MessageEvent<string>) => {
    try {
      const data = JSON.parse(e.data) as RunEvent;
      const eventId = e.lastEventId || undefined;
      if (eventId) {
        currentLastEventId = eventId;
      }
      onMessage(data, eventId);
    } catch (parseError) {
      console.error('Failed to parse SSE message:', parseError);
    }
  };

  const clearRetryTimeout = () => {
    if (retryTimeout) {
      clearTimeout(retryTimeout);
      retryTimeout = null;
    }
  };

  const connect = () => {
    clearRetryTimeout();

    // Clean up existing connection
    if (es) {
      es.close();
      es = null;
    }

    updateStatus('connecting');

    // Build URL with Last-Event-ID for server-side resumption support
    let url = `/api/runs/${encodeURIComponent(runId)}/stream`;
    if (currentLastEventId) {
      url += `?lastEventId=${encodeURIComponent(currentLastEventId)}`;
    }

    es = new EventSource(url);
    es.onmessage = handleIncoming;

    const namedEvents = [
      'sync',
      'step.started',
      'step.stream',
      'step.completed',
      'step.failed',
      'step.skipped',
      'gate.waiting',
      'gate.resolved',
      'workflow.completed',
      'workflow.failed',
      'run.closed',
    ];
    namedEvents.forEach((eventName) => {
      es?.addEventListener(eventName, handleIncoming as EventListener);
    });

    es.onerror = () => {
      updateStatus(retryCount < maxRetries ? 'reconnecting' : 'error');

      if (retryCount < maxRetries) {
        // Exponential backoff
        const delay = Math.min(retryDelayMs * Math.pow(2, retryCount), maxRetryDelayMs);
        retryCount++;

        console.warn(`SSE connection error, retrying in ${delay}ms (attempt ${retryCount}/${maxRetries})`);

        retryTimeout = setTimeout(() => {
          connect();
        }, delay);

        onError?.(new Error('Connection lost, reconnecting...'), retryCount);
      } else {
        console.error(`SSE connection failed after ${maxRetries} retries`);
        es?.close();
        es = null;
        updateStatus('disconnected');
        onError?.(new Error('Connection failed after max retries'));
      }
    };

    es.onopen = () => {
      retryCount = 0;
      updateStatus('connected');
    };
  };

  connect();

  // Return connection object with control methods
  return {
    close: () => {
      clearRetryTimeout();
      if (es) {
        es.close();
        es = null;
      }
      updateStatus('disconnected');
    },
    getReadyState: () => es?.readyState ?? EventSource.CLOSED,
    // Allow manual reconnect
    reconnect: () => {
      retryCount = 0;
      connect();
    },
  };
}
