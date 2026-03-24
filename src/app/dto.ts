import type { RunStatus, StepStatus, WorkflowConfig } from '../types/index.js';

// Re-export RunStatus for convenience
export type { RunStatus } from '../types/index.js';

export interface WorkflowSummaryDto {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  hasGate: boolean;
  hasEval: boolean;
}

export interface WorkflowDetailDto extends WorkflowSummaryDto {
  steps: Array<{
    id: string;
    agent: string;
    gate: 'auto' | 'approve';
    dependsOn: string[];
  }>;
}

export interface RunStepDto {
  id: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  outputFile?: string;
  error?: string;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens: number;
  };
  durationMs?: number;
}

export interface RunSummaryDto {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
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

export interface RunDetailDto {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  input: string;
  inputData?: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  tokenUsage?: TokenUsage;
  steps: RunDetailStepDto[];
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

export interface RunDetailStepDto {
  stepId: string;
  name: string;
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  output?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens: number;
  };
}

// =============================================================================
// Cost Observation DTOs (M5)
// =============================================================================

/**
 * Information about a single step's cost contribution.
 */
export interface StepCostInfo {
  stepId: string;
  name: string;
  /** Total tokens used by this step */
  tokens?: number;
  /** Duration of this step in milliseconds */
  durationMs?: number;
  /** Percentage of total run tokens (0-100) */
  percentTokens?: number;
  /** Percentage of total run duration (0-100) */
  percentDuration?: number;
}

/**
 * Cost summary for a run, including identification of high-cost steps.
 */
export interface RunCostSummary {
  /** Total tokens used by the run (sum of all steps) */
  totalTokens?: number;
  /** Total duration of the run in milliseconds */
  totalDurationMs?: number;
  /** Steps with highest token consumption, sorted descending */
  topTokensSteps: StepCostInfo[];
  /** Steps with longest duration, sorted descending */
  topDurationSteps: StepCostInfo[];
  /** Average tokens per step */
  avgTokensPerStep?: number;
  /** Average duration per step */
  avgDurationMsPerStep?: number;
}

export interface PendingGateDto {
  runId?: string;
  stepId: string;
  createdAt: number;
  outputPreview: string;
}

export type GateActionType = 'approve' | 'reject' | 'edit';

export interface GateActionRequestDto {
  action: GateActionType;
  editedOutput?: string;
}

type WebRunEventBase = {
  ts: number;
  runId: string;
};

export type WebRunEventPayload =
  | {
      type: 'workflow.started';
      workflowId: string;
      resumed: boolean;
      input: string;
    }
  | { type: 'workflow.completed' }
  | { type: 'workflow.failed'; error: string }
  | { type: 'workflow.interrupted' }
  | { type: 'step.started'; stepId: string }
  | {
      type: 'step.completed';
      stepId: string;
      duration: number;
      outputPreview: string;
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens: number;
      };
    }
  | { type: 'step.failed'; stepId: string; error: string }
  | { type: 'step.skipped'; stepId: string; reason: string }
  | { type: 'step.retrying'; stepId: string; attempt: number; maxAttempts: number; error: string }
  | { type: 'step.stream'; stepId: string; chunk: string }
  | { type: 'gate.waiting'; stepId: string; preview: string }
  | { type: 'gate.resolved'; stepId: string; action: 'continue' | 'abort' | 'edit' };

export type WebRunEvent = WebRunEventBase &
  WebRunEventPayload & {
    id: string;
    sequence?: number; // Added for SSE consistency (T4)
  };

// =============================================================================
// Visual DTOs for v6 - Workflow Visualization
// =============================================================================

export type NodeStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'streaming'
  | 'gate_waiting'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'cached';

// TokenUsage compatible with types/index.ts
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
}

// Workflow Visual Summary DTOs

export type WorkflowVisualNodeType = 'agent' | 'gate' | 'eval' | 'script' | 'start' | 'end';

export interface WorkflowVisualNode {
  id: string;
  name: string;
  type: WorkflowVisualNodeType;
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

export interface WorkflowVisualSummaryDto {
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

// Run Visual State DTOs

export interface RunNodeStateDto {
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

export interface RunVisualStateDto {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  nodeStates: Record<string, RunNodeStateDto>;
  currentActiveNodeIds: string[];
  gateWaitingNodeIds: string[];
  failedNodeIds: string[];
  tokenUsage?: TokenUsage;
  version: number; // Snapshot version for consistency
  lastEventId?: string; // Last processed event ID
}

export interface TimelineEntry {
  id: string;
  event: string;
  timestamp: number;
  stepId?: string;
  details?: string;
  status?: 'success' | 'error' | 'warning' | 'info';
}

// Diagnostics DTOs

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

export interface ErrorSummary {
  nodeId: string;
  errorType: string;
  errorMessage: string;
  suggestedActions: string[];
}

export interface DiagnosticsSummaryDto {
  runId: string;
  workflowId: string;
  workflowName?: string;
  runStatus: RunStatus;
  failedNodeIds: string[];
  gateWaitingNodeIds: string[];
  failedNodes: FailedNodeDetail[];
  downstreamImpact: DownstreamImpactNode[];
  failurePropagation?: FailurePropagation;
  errorSummary: ErrorSummary[];
  upstreamStates: Record<string, NodeStatus>;
  recommendedActions: RecommendedAction[];
  /** Recovery scope preview for failed runs - computed from dependency analysis */
  recoveryScope?: {
    /** Number of steps that would be reused from source run */
    reusedCount: number;
    /** Number of steps that would be re-executed */
    rerunCount: number;
    /** Number of steps that would be invalidated (downstream of rerun steps) */
    invalidatedCount: number;
    /** Risk level of the recovery operation */
    riskLevel: 'low' | 'medium' | 'high';
    /** Summary description of what recovery would do */
    summary: string;
  };
}

// =============================================================================
// Quality Observation DTOs (M6)
// =============================================================================

/**
 * Summary of a single recent run for quality tracking.
 */
export interface QualityRunSummary {
  runId: string;
  status: 'completed' | 'failed' | 'running' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** Primary error type if failed */
  errorType?: string;
}

/**
 * Failure type distribution within a workflow.
 */
export interface FailureTypeDistribution {
  errorType: string;
  count: number;
  percentage: number;
}

/**
 * Gate waiting statistics for a workflow.
 */
export interface GateWaitStats {
  /** Total number of gate waits across all runs */
  totalGateWaits: number;
  /** Number of runs that had at least one gate wait */
  runsWithGateWait: number;
  /** Most recent gate wait timestamp */
  lastGateWaitAt?: number;
}

/**
 * Eval summary for a workflow (if eval is enabled).
 */
export interface EvalSummary {
  /** Number of runs with eval results */
  runsWithEval: number;
  /** Average eval score across runs with eval */
  avgScore?: number;
  /** Most recent eval score */
  lastScore?: number;
  /** Score trend: 'improving' | 'declining' | 'stable' | 'insufficient_data' */
  trend?: 'improving' | 'declined' | 'stable' | 'insufficient_data';
}

/**
 * Workflow-level quality summary aggregating multiple runs.
 * M6: Quality observation capability.
 */
export interface WorkflowQualitySummary {
  /** Workflow identifier */
  workflowId: string;
  /** Workflow name (if available) */
  workflowName?: string;
  /** Total number of runs for this workflow */
  totalRuns: number;
  /** Number of successful runs */
  successCount: number;
  /** Number of failed runs */
  failureCount: number;
  /** Running or interrupted runs */
  activeCount: number;
  /** Success rate as percentage (0-100) */
  successRate: number;
  /** Failure rate as percentage (0-100) */
  failureRate: number;
  /** Average duration of completed runs in milliseconds */
  avgDurationMs?: number;
  /** Gate waiting statistics */
  gateWaitStats: GateWaitStats;
  /** Failure type distribution (sorted by count descending) */
  failureTypes: FailureTypeDistribution[];
  /** Eval summary (if available) */
  evalSummary?: EvalSummary;
  /** Most recent runs for quick display */
  recentRuns: QualityRunSummary[];
  /** Timestamp when this summary was computed */
  computedAt: number;
}

export type InputDiffType = 'added' | 'removed' | 'changed' | 'type_changed';

export interface InputDiff {
  field: string;
  valueA: unknown;
  valueB: unknown;
  /** Type of difference */
  diffType: InputDiffType;
  /** Type information for type_changed */
  typeA?: string;
  typeB?: string;
}

export interface NodeStatusDiff {
  nodeId: string;
  statusA: NodeStatus;
  statusB: NodeStatus;
  /** Duration difference in milliseconds */
  durationDiff?: {
    runA?: number;
    runB?: number;
    delta?: number;
  };
  /** Error message if node failed */
  errorA?: string;
  errorB?: string;
  /** Whether this is a critical node (first failure or significant impact) */
  isCritical?: boolean;
}

export interface DurationDiff {
  runA: number;
  runB: number;
  /** Absolute difference in milliseconds */
  delta: number;
  /** Percentage change: ((runB - runA) / runA) * 100 */
  percentChange?: number;
}

export interface OutputDiffItem {
  nodeId: string;
  /** Whether output exists in each run */
  hasOutputA: boolean;
  hasOutputB: boolean;
  /** Output preview (truncated) */
  previewA?: string;
  previewB?: string;
  /** Whether outputs are identical */
  isIdentical: boolean;
}

export interface ComparisonSummary {
  /** Overall similarity score (0-100) based on input, nodes, and output */
  similarityScore: number;
  /** Key differences that impact decision making */
  keyDifferences: string[];
  /** Recommendations based on comparison */
  recommendations: string[];
  /** Risk warnings */
  warnings: string[];
}

export interface RunComparisonDto {
  runAId: string;
  runBId: string;
  /** Workflow info for context */
  workflowInfo?: {
    workflowId: string;
    name: string;
    isSameWorkflow: boolean;
  };
  inputDiff?: InputDiff[];
  /** Summary of input differences */
  inputDiffSummary?: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  statusDiff: {
    runA: RunStatus;
    runB: RunStatus;
  };
  nodeStatusDiff?: NodeStatusDiff[];
  /** Summary of node differences */
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
    /** Difference in total tokens */
    delta?: number;
    /** Percentage change */
    percentChange?: number;
  };
  outputDiff?: OutputDiffItem[];
  /** Summary for decision making */
  summary: ComparisonSummary;
}

export interface RunComparisonSessionDto {
  sessionId: string;
  createdAt: number;
  /** Time-to-live in milliseconds */
  ttl: number;
  /** Expiration timestamp */
  expiresAt: number;
  comparison: RunComparisonDto;
}

// Config Draft DTOs

export interface RuntimeOptions {
  stream?: boolean;
  autoApprove?: boolean;
  noEval?: boolean;
}

export interface ConfigDraftDto {
  draftId: string;
  workflowId: string;
  name: string;
  inputData: Record<string, unknown>;
  runtimeOptions?: RuntimeOptions;
  createdAt: number;
  updatedAt: number;
}

/**
 * Reusable config extracted from a historical run.
 * Contains all information needed to rerun or create a draft.
 */
export interface ReusableConfigDto {
  /** Source run ID */
  runId: string;
  workflowId: string;
  workflowName?: string;
  /** Plain text input (if any) */
  input: string;
  /** Structured input data */
  inputData: Record<string, unknown>;
  /** Runtime options used in the original run */
  runtimeOptions: RuntimeOptions;
  /** Original run status */
  runStatus: 'completed' | 'failed' | 'interrupted';
  /** Original run timestamp */
  startedAt: number;
  /** Original run duration */
  durationMs?: number;
}

/**
 * Preview of rerun changes before execution.
 * Shows the difference between original and new config.
 */
export interface RerunPreviewDto {
  /** Source run info */
  sourceRun: {
    runId: string;
    status: 'completed' | 'failed' | 'interrupted';
    startedAt: number;
    durationMs?: number;
  };
  /** Workflow info */
  workflow: {
    workflowId: string;
    name: string;
    stepCount: number;
    hasGate: boolean;
  };
  /** Input changes */
  inputDiff?: InputDiffItem[];
  /** Runtime options changes */
  runtimeOptionsDiff?: {
    field: 'stream' | 'autoApprove' | 'noEval';
    original: boolean;
    new: boolean;
  }[];
  /** Warnings about the rerun */
  warnings?: string[];
}

export interface InputDiffItem {
  field: string;
  original?: unknown;
  new?: unknown;
  type: 'added' | 'removed' | 'changed';
}

/**
 * Recovery options for partial run recovery.
 * Reserved for future node-level recovery support.
 * @deprecated Use RecoveryRequestDto for node-level recovery instead.
 */
export interface RecoveryOptions {
  /** Resume from a specific step (skip completed steps) */
  resumeFromStep?: string;
  /** Use cached outputs for specific steps */
  useCachedSteps?: string[];
  /** Force re-run specific steps */
  forceRerunSteps?: string[];
}

// =============================================================================
// Recovery DTOs (M1 - Node-Level Recovery)
// =============================================================================

/**
 * Request to recover a failed run by selectively reusing completed nodes
 * and re-running failed/downstream nodes.
 */
export interface RecoveryRequestDto {
  /** Source run ID to recover from (must be failed) */
  sourceRunId: string;
  /** Step to resume from. Defaults to first failed step. */
  resumeFromStep?: string;
  /** Explicit list of steps to reuse (completed steps with valid outputs).
   * If not provided, inferred from resumeFromStep and dependency graph. */
  reuseSteps?: string[];
  /** Explicit list of steps to force re-run even if completed.
   * Useful when step logic needs to change. */
  forceRerunSteps?: string[];
  /** Input data overrides for the recovery run.
   * If provided, creates a derived run with modified input. */
  inputData?: Record<string, unknown>;
  /** Runtime options overrides */
  runtimeOptions?: RuntimeOptions;
}

/**
 * Step-level recovery classification for preview.
 */
export type RecoverableStepType =
  /** Step output will be reused from source run */
  | 'reused'
  /** Step will be re-executed */
  | 'rerun'
  /** Step result becomes invalid due to upstream changes */
  | 'invalidated'
  /** Step status unchanged but downstream may be affected */
  | 'at_risk';

/**
 * Preview of a single step's recovery status.
 */
export interface RecoveryStepPreview {
  stepId: string;
  stepName?: string;
  /** Current status in source run */
  currentStatus: StepStatus;
  /** Classification in recovery run */
  recoveryAction: RecoverableStepType;
  /** Reason for the action */
  reason: string;
}

/**
 * Downstream impact warning for recovery preview.
 */
export interface RecoveryImpactWarning {
  stepId: string;
  stepName?: string;
  impactType: 'gate_reset' | 'eval_reset' | 'output_invalidated' | 'blocked';
  description: string;
}

/**
 * Preview response showing what a recovery operation would do.
 */
export interface RecoveryPreviewDto {
  /** Source run info */
  sourceRun: {
    runId: string;
    status: 'failed';
    failedAt: number;
    failedNodeIds: string[];
  };
  /** Workflow info */
  workflow: {
    workflowId: string;
    name: string;
    stepCount: number;
  };
  /** Steps that will be reused (completed with valid outputs) */
  reusedSteps: RecoveryStepPreview[];
  /** Steps that will be re-run */
  rerunSteps: RecoveryStepPreview[];
  /** Steps that become invalidated */
  invalidatedSteps: RecoveryStepPreview[];
  /** Steps at risk (unchanged but may have downstream effects) */
  atRiskSteps: RecoveryStepPreview[];
  /** Warnings about gates, evals, and downstream impacts */
  warnings: RecoveryImpactWarning[];
  /** Risk level of the recovery operation */
  riskLevel: 'low' | 'medium' | 'high';
  /** Summary description */
  summary: string;
}

/**
 * Result of a recovery operation.
 */
export interface RecoveryResultDto {
  /** New run created by recovery */
  newRunId: string;
  /** Source run that was recovered from */
  sourceRunId: string;
  /** Status of the new run request */
  status: 'running';
  /** Steps that were reused from source run */
  reusedStepIds: string[];
  /** Steps that were re-run */
  rerunStepIds: string[];
}

export interface RunStartRequestDto {
  workflowId: string;
  input: string;
  inputData?: Record<string, unknown>;
  stream?: boolean;
  autoApprove?: boolean;
  noEval?: boolean;
  /** Source run ID for rerun tracking */
  sourceRunId?: string;
  /** Recovery options for partial rerun (reserved for future use) */
  recoveryOptions?: RecoveryOptions;
}

export interface RunStartResponseDto {
  runId: string;
  status: 'running';
}

export interface SettingsDto {
  projectPath: string;
  locale: string;
  apiKeyConfigured: boolean;
  baseUrlConfigured: boolean;
}

// =============================================================================
// API Error Response - Unified Error Structure
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

export function mapWorkflowDetail(workflow: WorkflowConfig): WorkflowDetailDto {
  return {
    id: workflow.workflow.id,
    name: workflow.workflow.name,
    description: workflow.workflow.description,
    stepCount: workflow.steps.length,
    hasGate: workflow.steps.some((step) => (step.gate ?? 'auto') === 'approve'),
    hasEval: !!workflow.eval?.enabled,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      agent: step.agent,
      gate: step.gate ?? 'auto',
      dependsOn: step.depends_on ?? [],
    })),
  };
}
