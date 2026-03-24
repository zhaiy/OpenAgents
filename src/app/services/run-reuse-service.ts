import { ConfigLoader } from '../../config/loader.js';
import { StateManager } from '../../engine/state.js';
import type {
  InputDiffItem,
  ReusableConfigDto,
  RecoveryPreviewDto,
  RecoveryRequestDto,
  RecoveryResultDto,
  RerunPreviewDto,
  RunStartRequestDto,
  RuntimeOptions,
} from '../dto.js';
import type { StepConfig, StepStatus, WorkflowConfig } from '../../types/index.js';
import { classifyRecoverySteps, type RecoveryClassification } from './recovery-planner.js';

/**
 * Step-level recovery classification for preview.
 */
type RecoverableStepType = 'reused' | 'rerun' | 'invalidated' | 'at_risk';

/**
 * Service for managing run reuse, rerun, and recovery operations.
 *
 * Data Model Relationships:
 * - ReusableConfigDto: Extracted from historical run, contains full context for rerun
 * - ConfigDraftDto: User-saved draft, independent of runs
 * - RunStartRequestDto: Request to start a new run, can reference sourceRunId
 *
 * Rerun Flow:
 * 1. User selects a historical run
 * 2. getReusableConfig() extracts the config
 * 3. getRerunPreview() shows differences (if editing)
 * 4. createRerunPayload() creates the new run request
 */
export class RunReuseService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly loader: ConfigLoader,
  ) {}

  /**
   * Get reusable config from a historical run.
   * Returns full context including run status and timestamps.
   */
  getReusableConfig(runId: string): ReusableConfigDto | null {
    try {
      const run = this.stateManager.findRunById(runId);

      // Get workflow name
      let workflowName: string | undefined;
      try {
        const workflow = this.loader.loadWorkflow(run.workflowId);
        workflowName = workflow.workflow.name;
      } catch {
        // Workflow config may not be available
      }

      return {
        runId: run.runId,
        workflowId: run.workflowId,
        workflowName,
        input: run.input,
        inputData: run.inputData ?? {},
        runtimeOptions: {
          stream: true, // Default
        },
        runStatus: run.status as 'completed' | 'failed' | 'interrupted',
        startedAt: run.startedAt,
        durationMs: run.completedAt ? run.completedAt - run.startedAt : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get a preview of rerun changes.
   * Compares original config with proposed edits.
   */
  getRerunPreview(
    runId: string,
    edits?: {
      inputData?: Record<string, unknown>;
      runtimeOptions?: RuntimeOptions;
    },
  ): RerunPreviewDto | null {
    const config = this.getReusableConfig(runId);
    if (!config) return null;

    // Get workflow info
    let workflowInfo: RerunPreviewDto['workflow'];
    try {
      const workflow = this.loader.loadWorkflow(config.workflowId);
      workflowInfo = {
        workflowId: config.workflowId,
        name: workflow.workflow.name,
        stepCount: workflow.steps.length,
        hasGate: workflow.steps.some((s) => s.gate === 'approve'),
      };
    } catch {
      workflowInfo = {
        workflowId: config.workflowId,
        name: config.workflowName || config.workflowId,
        stepCount: 0,
        hasGate: false,
      };
    }

    // Calculate input diff
    const inputDiff = this.calculateInputDiff(
      config.inputData,
      edits?.inputData ?? config.inputData,
    );

    // Calculate runtime options diff
    const runtimeOptionsDiff = this.calculateRuntimeOptionsDiff(
      config.runtimeOptions,
      edits?.runtimeOptions ?? config.runtimeOptions,
    );

    // Generate warnings
    const warnings = this.generateWarnings(config, workflowInfo);

    return {
      sourceRun: {
        runId: config.runId,
        status: config.runStatus,
        startedAt: config.startedAt,
        durationMs: config.durationMs,
      },
      workflow: workflowInfo,
      inputDiff: inputDiff.length > 0 ? inputDiff : undefined,
      runtimeOptionsDiff: runtimeOptionsDiff.length > 0 ? runtimeOptionsDiff : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Create a rerun payload from a historical run.
   * Optionally includes edits and tracks the source run.
   */
  createRerunPayload(
    runId: string,
    edits?: Partial<RunStartRequestDto>,
  ): RunStartRequestDto | null {
    const config = this.getReusableConfig(runId);
    if (!config) return null;

    return {
      workflowId: config.workflowId,
      input: edits?.input ?? config.input,
      inputData: edits?.inputData ?? config.inputData,
      stream: edits?.stream ?? config.runtimeOptions.stream,
      autoApprove: edits?.autoApprove ?? config.runtimeOptions.autoApprove,
      noEval: edits?.noEval ?? config.runtimeOptions.noEval,
      sourceRunId: runId,
      recoveryOptions: edits?.recoveryOptions,
    };
  }

  /**
   * Create a rerun payload with edited input data.
   * Convenience method for the common edit-and-rerun case.
   */
  createEditedRerunPayload(
    runId: string,
    editedInputData: Record<string, unknown>,
    runtimeOptions?: RuntimeOptions,
  ): RunStartRequestDto | null {
    return this.createRerunPayload(runId, {
      inputData: editedInputData,
      stream: runtimeOptions?.stream,
      autoApprove: runtimeOptions?.autoApprove,
      noEval: runtimeOptions?.noEval,
    });
  }

  /**
   * Get the most recent run for a workflow.
   * Useful for suggesting rerun candidates.
   */
  getMostRecentRun(workflowId: string, status?: 'completed' | 'failed' | 'interrupted'): string | null {
    const runs = this.stateManager.listRuns({ workflowId });

    const filtered = status
      ? runs.filter((r) => r.status === status)
      : runs.filter((r) => r.status === 'completed' || r.status === 'failed' || r.status === 'interrupted');

    if (filtered.length === 0) return null;

    // Sort by startedAt descending
    filtered.sort((a, b) => b.startedAt - a.startedAt);

    return filtered[0].runId;
  }

  /**
   * Get last successful run for a workflow.
   */
  getLastSuccessfulRun(workflowId: string): string | null {
    return this.getMostRecentRun(workflowId, 'completed');
  }

  /**
   * Get last failed run for a workflow.
   */
  getLastFailedRun(workflowId: string): string | null {
    return this.getMostRecentRun(workflowId, 'failed');
  }

  /**
   * List recent runs for a workflow suitable for reuse.
   */
  listReusableRuns(
    workflowId: string,
    limit: number = 5,
  ): Array<{
    runId: string;
    status: string;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
    inputSummary: string;
  }> {
    const runs = this.stateManager.listRuns({ workflowId });

    return runs
      .filter((r) => r.status === 'completed' || r.status === 'failed' || r.status === 'interrupted')
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit)
      .map((run) => ({
        runId: run.runId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.completedAt ? run.completedAt - run.startedAt : undefined,
        inputSummary: this.summarizeInput(run.inputData),
      }));
  }

  // =============================================================================
  // Recovery Methods (M1 - Node-Level Recovery)
  // =============================================================================

  /**
   * Get a preview of what a recovery operation would do.
   * Shows which steps would be reused, rerun, or invalidated.
   */
  getRecoveryPreview(request: RecoveryRequestDto): RecoveryPreviewDto | null {
    try {
      const sourceRun = this.stateManager.findRunById(request.sourceRunId);

      // Only failed runs can be recovered
      if (sourceRun.status !== 'failed') {
        return null;
      }

      // Load workflow for dependency information
      let workflow: WorkflowConfig | undefined;
      try {
        workflow = this.loader.loadWorkflow(sourceRun.workflowId);
      } catch {
        // Workflow may not be available
      }

      // Build step name map
      const stepNames = new Map<string, string>();
      if (workflow) {
        for (const step of workflow.steps) {
          stepNames.set(step.id, step.metadata?.displayName ?? step.id);
        }
      }

      // Find failed node IDs
      const failedNodeIds = Object.entries(sourceRun.steps)
        .filter(([, step]) => step.status === 'failed')
        .map(([stepId]) => stepId);

      // Determine recovery scope based on request
      const resumeFromStep = request.resumeFromStep ?? (failedNodeIds.length > 0 ? failedNodeIds[0] : undefined);

      // Classify each step
      const classification = this.classifyStepsForRecovery(
        sourceRun.steps,
        workflow?.steps ?? [],
        {
          resumeFromStep,
          reuseSteps: request.reuseSteps,
          forceRerunSteps: request.forceRerunSteps,
        },
      );

      // Calculate warnings
      const warnings = this.generateRecoveryWarnings(
        sourceRun.steps,
        workflow?.steps ?? [],
        classification,
        resumeFromStep,
        stepNames,
      );

      // Determine overall risk level
      const riskLevel = this.calculateRecoveryRiskLevel(classification, warnings);

      // Generate summary
      const summary = this.generateRecoverySummary(classification, failedNodeIds);

      return {
        sourceRun: {
          runId: sourceRun.runId,
          status: 'failed' as const,
          failedAt: sourceRun.completedAt ?? Date.now(),
          failedNodeIds,
        },
        workflow: {
          workflowId: sourceRun.workflowId,
          name: workflow?.workflow.name ?? sourceRun.workflowId,
          stepCount: Object.keys(sourceRun.steps).length,
        },
        reusedSteps: classification.reused.map((s) => ({
          stepId: s.stepId,
          stepName: stepNames.get(s.stepId),
          currentStatus: s.currentStatus as StepStatus,
          recoveryAction: 'reused' as RecoverableStepType,
          reason: s.reason,
        })),
        rerunSteps: classification.rerun.map((s) => ({
          stepId: s.stepId,
          stepName: stepNames.get(s.stepId),
          currentStatus: s.currentStatus as StepStatus,
          recoveryAction: 'rerun' as RecoverableStepType,
          reason: s.reason,
        })),
        invalidatedSteps: classification.invalidated.map((s) => ({
          stepId: s.stepId,
          stepName: stepNames.get(s.stepId),
          currentStatus: s.currentStatus as StepStatus,
          recoveryAction: 'invalidated' as RecoverableStepType,
          reason: s.reason,
        })),
        atRiskSteps: classification.atRisk.map((s) => ({
          stepId: s.stepId,
          stepName: stepNames.get(s.stepId),
          currentStatus: s.currentStatus as StepStatus,
          recoveryAction: 'at_risk' as RecoverableStepType,
          reason: s.reason,
        })),
        warnings,
        riskLevel,
        summary,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a recovery payload for starting a recovery run.
   * A recovery run reuses completed steps from the source run
   * and re-runs failed/downstream steps.
   */
  createRecoveryPayload(request: RecoveryRequestDto): RunStartRequestDto | null {
    try {
      const sourceRun = this.stateManager.findRunById(request.sourceRunId);

      // Only failed runs can be recovered
      if (sourceRun.status !== 'failed') {
        return null;
      }

      // Get reusable config from source run
      const config = this.getReusableConfig(request.sourceRunId);
      if (!config) return null;

      // Determine which steps to reuse vs rerun
      let workflow: WorkflowConfig | undefined;
      try {
        workflow = this.loader.loadWorkflow(sourceRun.workflowId);
      } catch {
        // Workflow may not be available
      }

      // Find failed node IDs
      const failedNodeIds = Object.entries(sourceRun.steps)
        .filter(([, step]) => step.status === 'failed')
        .map(([stepId]) => stepId);

      // Determine recovery scope
      const resumeFromStep = request.resumeFromStep ?? (failedNodeIds.length > 0 ? failedNodeIds[0] : undefined);

      const classification = this.classifyStepsForRecovery(
        sourceRun.steps,
        workflow?.steps ?? [],
        {
          resumeFromStep,
          reuseSteps: request.reuseSteps,
          forceRerunSteps: request.forceRerunSteps,
        },
      );

      // Build the recovery options with explicit reuse/rerun lists
      const recoveryOptions: { reuseSteps: string[]; forceRerunSteps: string[] } = {
        reuseSteps: classification.reused.map((s) => s.stepId),
        forceRerunSteps: [...classification.rerun.map((s) => s.stepId), ...classification.invalidated.map((s) => s.stepId)],
      };

      return {
        workflowId: config.workflowId,
        input: config.input,
        inputData: request.inputData ?? config.inputData,
        stream: request.runtimeOptions?.stream ?? config.runtimeOptions.stream ?? true,
        autoApprove: request.runtimeOptions?.autoApprove ?? config.runtimeOptions.autoApprove,
        noEval: request.runtimeOptions?.noEval ?? config.runtimeOptions.noEval,
        sourceRunId: request.sourceRunId,
        recoveryOptions: {
          resumeFromStep,
          useCachedSteps: recoveryOptions.reuseSteps,
          forceRerunSteps: recoveryOptions.forceRerunSteps,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the result of a recovery operation after it starts.
   * Returns metadata about what was reused vs rerun.
   */
  getRecoveryResult(newRunId: string, sourceRunId: string): RecoveryResultDto | null {
    try {
      const sourceRun = this.stateManager.findRunById(sourceRunId);

      if (sourceRun.status !== 'failed') {
        return null;
      }

      // Load workflow for dependency information
      let workflow: WorkflowConfig | undefined;
      try {
        workflow = this.loader.loadWorkflow(sourceRun.workflowId);
      } catch {
        // Workflow may not be available
      }

      // Find failed node IDs
      const failedNodeIds = Object.entries(sourceRun.steps)
        .filter(([, step]) => step.status === 'failed')
        .map(([stepId]) => stepId);

      const classification = this.classifyStepsForRecovery(
        sourceRun.steps,
        workflow?.steps ?? [],
        {
          resumeFromStep: failedNodeIds.length > 0 ? failedNodeIds[0] : undefined,
        },
      );

      return {
        newRunId,
        sourceRunId,
        status: 'running',
        reusedStepIds: classification.reused.map((s) => s.stepId),
        rerunStepIds: [...classification.rerun.map((s) => s.stepId), ...classification.invalidated.map((s) => s.stepId)],
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // Private helper methods for recovery
  // ===========================================================================

  private classifyStepsForRecovery(
    stepStates: Record<string, { status: string; outputFile?: string; error?: string }>,
    stepConfigs: StepConfig[],
    options: {
      resumeFromStep?: string;
      reuseSteps?: string[];
      forceRerunSteps?: string[];
    },
  ): RecoveryClassification {
    return classifyRecoverySteps(stepStates, stepConfigs, options);
  }

  private generateRecoveryWarnings(
    stepStates: Record<string, { status: string; error?: string }>,
    stepConfigs: StepConfig[],
    classification: RecoveryClassification,
    _resumeFromStep: string | undefined,
    stepNames: Map<string, string>,
  ): RecoveryPreviewDto['warnings'] {
    const warnings: RecoveryPreviewDto['warnings'] = [];

    // Gates will only reset for steps that are actually going to execute again.
    for (const stepId of [...classification.rerun, ...classification.invalidated].map((s) => s.stepId)) {
      const stepConfig = stepConfigs.find((s) => s.id === stepId);
      if (stepConfig?.gate === 'approve') {
        warnings.push({
          stepId,
          stepName: stepNames.get(stepId),
          impactType: 'gate_reset',
          description: `Gate at "${stepNames.get(stepId) ?? stepId}" will require manual approval again`,
        });
      }
    }

    // Check if there are invalidated steps that had outputs
    if (classification.invalidated.length > 0) {
      warnings.push({
        stepId: classification.invalidated[0].stepId,
        stepName: stepNames.get(classification.invalidated[0].stepId),
        impactType: 'output_invalidated',
        description: `${classification.invalidated.length} downstream step(s) may produce different outputs`,
      });
    }

    return warnings;
  }

  private calculateRecoveryRiskLevel(
    classification: RecoveryClassification,
    warnings: RecoveryPreviewDto['warnings'],
  ): 'low' | 'medium' | 'high' {
    // High risk: many steps to rerun or many warnings
    const executionCount = classification.rerun.length + classification.invalidated.length;
    const rerunRatio = executionCount /
      (executionCount + classification.reused.length + 1);

    if (rerunRatio > 0.5 || warnings.length > 3) {
      return 'high';
    }

    // Low risk: few steps to rerun, no gates
    const hasGateWarnings = warnings.some((w) => w.impactType === 'gate_reset');
    if (rerunRatio < 0.2 && !hasGateWarnings) {
      return 'low';
    }

    return 'medium';
  }

  private generateRecoverySummary(
    classification: RecoveryClassification,
    failedNodeIds: string[],
  ): string {
    const reusedCount = classification.reused.length;
    const rerunCount = classification.rerun.length + classification.invalidated.length;
    const invalidatedCount = classification.invalidated.length;

    if (reusedCount === 0 && rerunCount === 0) {
      return 'No steps to recover';
    }

    let summary = `Will reuse ${reusedCount} step(s) from source run. `;
    if (rerunCount > 0) {
      summary += `Will re-run ${rerunCount} step(s) including ${failedNodeIds[0] ?? 'failure point'}. `;
    }
    if (invalidatedCount > 0) {
      summary += `${invalidatedCount} completed downstream step(s) will be regenerated.`;
    }

    return summary;
  }

  // ===========================================================================
  // Private helper methods
  // ===========================================================================

  private calculateInputDiff(
    original: Record<string, unknown>,
    newInput: Record<string, unknown>,
  ): InputDiffItem[] {
    const diff: InputDiffItem[] = [];
    const allKeys = new Set([...Object.keys(original), ...Object.keys(newInput)]);

    for (const key of allKeys) {
      const hasOriginal = key in original;
      const hasNew = key in newInput;

      if (!hasOriginal && hasNew) {
        diff.push({ field: key, new: newInput[key], type: 'added' });
      } else if (hasOriginal && !hasNew) {
        diff.push({ field: key, original: original[key], type: 'removed' });
      } else if (JSON.stringify(original[key]) !== JSON.stringify(newInput[key])) {
        diff.push({ field: key, original: original[key], new: newInput[key], type: 'changed' });
      }
    }

    return diff;
  }

  private calculateRuntimeOptionsDiff(
    original: RuntimeOptions,
    newOptions: RuntimeOptions,
  ): Array<{ field: 'stream' | 'autoApprove' | 'noEval'; original: boolean; new: boolean }> {
    const diff: Array<{ field: 'stream' | 'autoApprove' | 'noEval'; original: boolean; new: boolean }> = [];

    const fields: Array<'stream' | 'autoApprove' | 'noEval'> = ['stream', 'autoApprove', 'noEval'];

    for (const field of fields) {
      const originalValue = original[field] ?? false;
      const newValue = newOptions[field] ?? false;

      if (originalValue !== newValue) {
        diff.push({ field, original: originalValue, new: newValue });
      }
    }

    return diff;
  }

  private generateWarnings(
    config: ReusableConfigDto,
    workflowInfo: RerunPreviewDto['workflow'],
  ): string[] {
    const warnings: string[] = [];

    // Warn if rerunning a failed run without changes
    if (config.runStatus === 'failed') {
      warnings.push('This run previously failed. Consider reviewing the error before rerunning.');
    }

    // Warn if workflow has gates but autoApprove is not set
    if (workflowInfo.hasGate) {
      warnings.push('This workflow has gates that may require manual approval.');
    }

    // Warn if rerunning an interrupted run
    if (config.runStatus === 'interrupted') {
      warnings.push('This run was interrupted. The new run will start from the beginning.');
    }

    return warnings;
  }

  private summarizeInput(inputData?: Record<string, unknown>): string {
    if (!inputData) return 'No input data';
    const keys = Object.keys(inputData);
    if (keys.length === 0) return 'Empty input';
    if (keys.length <= 3) {
      return keys.map((k) => `${k}`).join(', ');
    }
    return `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
  }
}
