export type RuntimeType = 'llm-direct' | 'openclaw' | 'opencode' | 'claude-code' | 'script';

/**
 * Skill permission configuration.
 * Defines what resources the skill can access.
 */
export interface SkillPermissions {
  /** Whether the skill needs network access. Default: false */
  network?: boolean;
  /** File system access level. Default: 'none' */
  filesystem?: 'none' | 'read-only' | 'read-write';
  /** Environment variables the skill needs access to */
  environment?: string[];
}

/**
 * Skill dependency configuration.
 * Declares other skills and tools this skill depends on.
 */
export interface SkillDependencies {
  /** IDs of other skills this skill depends on */
  skills?: string[];
  /** Tools (MCP or script) this skill depends on */
  tools?: ToolConfig[];
}

/**
 * Skill example for documentation.
 */
export interface SkillExample {
  /** Example input */
  input: Record<string, unknown>;
  /** Preview of expected output */
  output_preview?: string;
}

/**
 * Risk level for a skill.
 * - low: No security risk, pure text processing
 * - medium: Processes user input but doesn't execute
 * - high: May execute code or access external resources
 */
export type SkillRiskLevel = 'low' | 'medium' | 'high';

/**
 * Skill metadata within the skill configuration.
 */
export interface SkillMeta {
  /** Unique identifier, format: [a-z][a-z0-9_-]* */
  id: string;
  /** Display name */
  name: string;
  /** Description of the skill's functionality */
  description: string;
  /** Semantic version string */
  version: string;
  /** Author information */
  author?: string;
  /** Tags for categorization and search */
  tags?: string[];
  /** Documentation or homepage URL */
  homepage?: string;
  /** Source repository URL */
  repository?: string;
}

/**
 * Complete skill configuration.
 * 
 * This is the standardized skill specification for OpenAgents.
 * See docs/SKILL-SPEC.md for full documentation.
 */
export interface SkillConfig {
  /** Skill metadata */
  skill: SkillMeta;
  /** Instructions for the LLM */
  instructions: string;
  /** Output format template (Markdown) */
  output_format?: string;
  /** JSON Schema for input validation */
  input_schema?: Record<string, unknown>;
  /** Permission requirements */
  permissions?: SkillPermissions;
  /** Dependencies on other skills and tools */
  dependencies?: SkillDependencies;
  /** Risk level assessment */
  risk_level?: SkillRiskLevel;
  /** Detailed risk description */
  risk_description?: string;
  /** Usage examples */
  examples?: SkillExample[];
}

export interface AgentConfig {
  agent: {
    id: string;
    name: string;
    description: string;
  };
  prompt: {
    system: string;
  };
  runtime: {
    type: RuntimeType;
    model?: string;
    api_key?: string;
    api_base_url?: string;
    timeout_seconds: number;
  };
  script?: {
    file?: string;
    inline?: string;
  };
  skills?: string[];
  tools?: ToolConfig[];
}

export type ToolConfig = MCP_toolConfig | Script_toolConfig;

export interface MCP_toolConfig {
  type: 'mcp';
  server: string;
  tool: string;
}

export interface Script_toolConfig {
  type: 'script';
  path: string;
  args?: string[];
}

export interface RetryConfig {
  max_attempts: number;
  delay_seconds: number;
}

export interface CacheConfig {
  enabled: boolean;
  ttl?: number; // seconds, default 3600
  key?: string; // custom key template (optional)
}

export type GateType = 'auto' | 'approve';

export type OnFailureAction = 'fail' | 'skip' | 'fallback' | 'notify';

export interface NotifyConfig {
  webhook?: string;
}

export interface GateOptions {
  autoApprove?: boolean;
  gateTimeoutSeconds?: number;
}

export type PostProcessorType = 'script';
export type PostProcessorErrorMode = 'fail' | 'skip' | 'passthrough';

export interface ScriptPostProcessorConfig {
  type: PostProcessorType;
  name?: string;
  command: string;
  timeout_ms?: number;
  max_output_chars?: number;
  on_error?: PostProcessorErrorMode;
}

export type ContextStrategy = 'raw' | 'truncate' | 'summarize' | 'auto';

export interface StepContextConfig {
  from: string;
  strategy: ContextStrategy;
  max_tokens?: number;
  inject_as?: 'system' | 'user';
}

export interface WorkflowMetadata {
  displayName?: string;
  description?: string;
  tags?: string[];
}

export interface StepMetadata {
  displayName?: string;
  description?: string;
  tags?: string[];
}

export interface StepConfig {
  id: string;
  agent: string;
  task: string;
  metadata?: StepMetadata;
  depends_on?: string[];
  gate?: GateType;
  retry?: RetryConfig;
  cache?: CacheConfig;
  on_failure?: OnFailureAction;
  fallback_agent?: string;
  notify?: NotifyConfig;
  post_processors?: ScriptPostProcessorConfig[];
  context?: StepContextConfig;
}

export interface OutputFileConfig {
  step: string;
  filename: string;
}

export interface WorkflowConfig {
  workflow: {
    id: string;
    name: string;
    description: string;
    metadata?: WorkflowMetadata;
  };
  steps: StepConfig[];
  output: {
    directory: string;
    files?: OutputFileConfig[];
  };
  cache?: CacheConfig;
  eval?: EvalConfig;
}

export interface ProjectConfig {
  version: string;
  runtime: {
    default_type: RuntimeType;
    default_model: string;
    api_key?: string;
    api_base_url?: string;
  };
  retry: RetryConfig;
  output: {
    base_directory: string;
    preview_lines: number;
  };
  context?: {
    auto_raw_threshold?: number;
    auto_truncate_threshold?: number;
    summary_model?: string;
    summary_api_key?: string;
    summary_api_base_url?: string;
  };
}

export type StepStatus = 'pending' | 'running' | 'gate_waiting' | 'completed' | 'failed' | 'interrupted' | 'skipped';
export type RunStatus = 'running' | 'completed' | 'failed' | 'interrupted';

export interface StepState {
  status: StepStatus;
  startedAt?: number;
  completedAt?: number;
  outputFile?: string;
  error?: string;
  retryCount?: number;
  tokenUsage?: TokenUsage;
  durationMs?: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
}

export interface RunState {
  runId: string;
  workflowId: string;
  status: RunStatus;
  input: string;
  inputData?: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  steps: Record<string, StepState>;
  /** Source run ID if this run was created via recovery/rerun */
  sourceRunId?: string;
  /** Recovery metadata if this run was created via recovery */
  recoveryInfo?: {
    reusedStepIds: string[];
    rerunStepIds: string[];
  };
  /** Relationship to source run when sourceRunId exists. */
  sourceRunRelationship?: SourceRunRelationship;
  /** Workflow configuration snapshot captured at run start time.
   * Contains the step configurations for version comparison.
   * E1: Enables provenance tracking and version diffing. */
  workflowSnapshot?: WorkflowSnapshot;
}

export type SourceRunRelationship = 'recover' | 'rerun' | 'rerun_with_edits';

/**
 * Snapshot of workflow configuration at a point in time.
 * Used for version comparison and provenance tracking.
 */
export interface WorkflowSnapshot {
  /** Hash of the workflow configuration for version identification */
  versionHash: string;
  /** Workflow ID (same as RunState.workflowId) */
  workflowId: string;
  /** Step snapshots for each node in the workflow */
  steps: Record<string, StepSnapshot>;
  /** When this snapshot was captured */
  capturedAt: number;
}

/**
 * Snapshot of a single step's configuration.
 */
export interface StepSnapshot {
  /** Step ID */
  id: string;
  /** Agent configuration snapshot */
  agent: {
    id: string;
    name: string;
    model?: string;
    runtimeType: RuntimeType;
  };
  /** System prompt at snapshot time */
  systemPrompt: string;
  /** Task description */
  task: string;
  /** Dependencies at snapshot time */
  dependsOn: string[];
  /** Gate type */
  gate?: GateType;
}

export type EventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.interrupted'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.skipped'
  | 'step.cached'
  | 'step.retrying'
  | 'gate.waiting'
  | 'gate.resolved'
  | 'gate.approved'
  | 'gate.rejected'
  | 'gate.edited';

export interface LogEvent {
  ts: number;
  event: EventType;
  data: Record<string, unknown>;
}

export interface DAGNode {
  id: string;
  dependencies: string[];
}

export interface ExecutionPlan {
  nodes: DAGNode[];
  order: string[];
  parallelGroups: string[][];
}

export interface ExecuteParams {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  timeoutSeconds: number;
  tools?: ToolDefinition[];
  toolExecutor?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ExecuteResult {
  output: string;
  tokensUsed?: number;
  tokenUsage?: TokenUsage;
  duration: number;
}

export interface AgentRuntime {
  execute(params: ExecuteParams): Promise<ExecuteResult>;
  executeStream?(
    params: ExecuteParams,
    onChunk: (chunk: string) => void,
  ): Promise<ExecuteResult>;
}

export interface EvalDimension {
  name: string;
  weight: number;
  prompt: string;
}

export interface EvalConfig {
  enabled: boolean;
  type: 'llm-judge';
  judge_model?: string;
  dimensions: EvalDimension[];
}

export interface EvaluationResult {
  runId: string;
  workflowId: string;
  evaluatedAt: string;
  score: number;
  dimensions: Record<string, { score: number; reason: string }>;
  tokenCost: number;
  duration: number;
  comparedToLast?: {
    lastRunId: string;
    lastScore: number;
    scoreDelta: number;
    direction: 'improved' | 'declined' | 'unchanged';
  };
}

export interface RunMetadata {
  runId: string;
  workflowId: string;
  agents: string[];
  models: string[];
  score?: number;
  tokenCost: number;
  duration: number;
  createdAt: string;
}
