import { ConfigLoader } from '../../config/loader.js';
import { StateManager } from '../../engine/state.js';
import type { RunState, StepConfig, WorkflowConfig } from '../../types/index.js';
import type {
  DiagnosticsSummaryDto,
  DownstreamImpactNode,
  ErrorSummary,
  FailedNodeDetail,
  FailurePropagation,
  NodeStatus,
  RecommendedAction,
  WorkflowQualitySummary,
  QualityRunSummary,
  FailureTypeDistribution,
  GateWaitStats,
  EvalSummary,
} from '../dto.js';
import { classifyRecoverySteps } from './recovery-planner.js';

interface ErrorMapping {
  pattern: RegExp;
  type: string;
  suggestedActions: string[];
  actionType: RecommendedAction['type'];
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  {
    pattern: /API key|api_key|authentication|unauthorized|401/i,
    type: 'AuthenticationError',
    suggestedActions: [
      'Check your API key configuration in Settings',
      'Verify the API key has sufficient permissions',
    ],
    actionType: 'check_api',
  },
  {
    pattern: /rate limit|too many requests|429/i,
    type: 'RateLimitError',
    suggestedActions: [
      'Wait before retrying',
      'Consider reducing request frequency',
    ],
    actionType: 'retry',
  },
  {
    pattern: /timeout|timed out|ETIMEDOUT/i,
    type: 'TimeoutError',
    suggestedActions: [
      'The operation took too long to complete',
      'Check your network connection',
    ],
    actionType: 'retry',
  },
  {
    pattern: /network|connection|ECONNREFUSED|DNS/i,
    type: 'NetworkError',
    suggestedActions: [
      'Check your network connection',
      'Verify the service endpoint is accessible',
    ],
    actionType: 'check_api',
  },
  {
    pattern: /parse|json|invalid.*format/i,
    type: 'ParseError',
    suggestedActions: [
      'Check the input data format',
      'Verify the input is valid JSON',
    ],
    actionType: 'fix_config',
  },
  {
    pattern: /memory|heap|out of memory/i,
    type: 'MemoryError',
    suggestedActions: [
      'The operation required too much memory',
      'Consider breaking down the task into smaller steps',
    ],
    actionType: 'rerun_with_edits',
  },
];

export class DiagnosticsService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly configLoader?: ConfigLoader,
  ) {}

  /**
   * Get list of failed runs with summary
   */
  getFailedRunsSummary(): Array<{
    runId: string;
    workflowId: string;
    failedAt: number;
    failedNodeId?: string;
    errorType?: string;
    errorMessage?: string;
  }> {
    const runs = this.stateManager.listRuns();

    return runs
      .filter((run) => run.status === 'failed')
      .map((run) => {
        const failedNodeId = this.findFailedNodeId(run.steps);
        const errorInfo = this.extractErrorInfo(run.steps);

        return {
          runId: run.runId,
          workflowId: run.workflowId,
          failedAt: run.completedAt ?? Date.now(),
          failedNodeId,
          errorType: errorInfo.type,
          errorMessage: errorInfo.message,
        };
      })
      .sort((a, b) => b.failedAt - a.failedAt);
  }

  /**
   * Get list of runs with waiting gates
   */
  getWaitingGatesSummary(): Array<{
    runId: string;
    workflowId: string;
    stepId: string;
    waitedAt: number;
    preview?: string;
  }> {
    const runs = this.stateManager.listRuns();

    return runs
      .filter((run) => run.status === 'running')
      .flatMap((run) => {
        const waitingGates: Array<{
          runId: string;
          workflowId: string;
          stepId: string;
          waitedAt: number;
          preview?: string;
        }> = [];

        for (const [stepId, stepState] of Object.entries(run.steps)) {
          if (stepState.status === 'gate_waiting') {
            waitingGates.push({
              runId: run.runId,
              workflowId: run.workflowId,
              stepId,
              waitedAt: stepState.startedAt ?? Date.now(),
              preview: stepState.error,
            });
          }
        }

        return waitingGates;
      })
      .sort((a, b) => b.waitedAt - a.waitedAt);
  }

  /**
   * Get diagnostics summary for a specific run
   */
  getRunDiagnostics(runId: string): DiagnosticsSummaryDto | null {
    try {
      const run = this.stateManager.findRunById(runId);

      // Get workflow config for dependency analysis
      const workflowConfig = this.loadWorkflowConfig(run.workflowId);

      // Build step dependency map
      const dependencyMap = this.buildDependencyMap(workflowConfig);
      const reverseDependencyMap = this.buildReverseDependencyMap(dependencyMap);
      const stepNames = this.buildStepNamesMap(workflowConfig);

      const failedNodeIds = this.findFailedNodeIds(run.steps);
      const gateWaitingNodeIds = this.findGateWaitingNodeIds(run.steps);
      const errorSummary = this.buildErrorSummary(run.steps);
      const upstreamStates = this.buildUpstreamStates(run.steps);

      // Build enhanced diagnostics
      const failedNodes = this.buildFailedNodeDetails(
        run.steps,
        failedNodeIds,
        dependencyMap,
        stepNames,
      );

      const downstreamImpact = this.buildDownstreamImpact(
        failedNodeIds,
        reverseDependencyMap,
        run.steps,
        stepNames,
      );

      const failurePropagation = this.buildFailurePropagation(
        failedNodeIds,
        downstreamImpact,
        dependencyMap,
      );

      const recommendedActions = this.buildRecommendedActions(
        run.runId,
        failedNodes,
        downstreamImpact,
        errorSummary,
        run.status === 'failed' ? this.computeRecoveryScope(run, workflowConfig) : undefined,
      );

      // Compute recovery scope for failed runs
      const recoveryScope = run.status === 'failed'
        ? this.computeRecoveryScope(run, workflowConfig)
        : undefined;

      return {
        runId,
        workflowId: run.workflowId,
        workflowName: workflowConfig?.workflow.name,
        runStatus: run.status,
        failedNodeIds,
        gateWaitingNodeIds,
        failedNodes,
        downstreamImpact,
        failurePropagation,
        errorSummary,
        upstreamStates,
        recommendedActions,
        recoveryScope,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get suggested actions for a specific error
   */
  getSuggestedActions(errorMessage?: string): string[] {
    if (!errorMessage) {
      return ['No specific error information available'];
    }

    for (const mapping of ERROR_MAPPINGS) {
      if (mapping.pattern.test(errorMessage)) {
        return mapping.suggestedActions;
      }
    }

    return [
      'Review the error message carefully',
      'Check the logs for more details',
      'Try running with debug mode if available',
      'Consider creating a new run with adjusted parameters',
    ];
  }

  /**
   * Get workflow-level quality summary aggregating multiple runs.
   * M6: Quality observation capability.
   *
   * @param workflowId - The workflow ID to get quality summary for
   * @param limit - Maximum number of recent runs to include (default 10)
   */
  getWorkflowQualitySummary(workflowId: string, limit = 10): WorkflowQualitySummary | null {
    try {
      const allRuns = this.stateManager.listRuns();
      const workflowRuns = allRuns.filter(run => run.workflowId === workflowId);

      if (workflowRuns.length === 0) {
        return null;
      }

      // Load workflow config for name
      let workflowName: string | undefined;
      try {
        const config = this.configLoader?.loadWorkflow(workflowId);
        workflowName = config?.workflow.name;
      } catch {
        // Workflow config not available
      }

      // Count by status
      const successCount = workflowRuns.filter(r => r.status === 'completed').length;
      const failureCount = workflowRuns.filter(r => r.status === 'failed').length;
      const activeCount = workflowRuns.filter(r => r.status === 'running' || r.status === 'interrupted').length;
      const totalRuns = workflowRuns.length;

      // Calculate rates
      const successRate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 10000) / 100 : 0;
      const failureRate = totalRuns > 0 ? Math.round((failureCount / totalRuns) * 10000) / 100 : 0;

      // Calculate average duration from completed runs
      const completedRuns = workflowRuns.filter(r => r.status === 'completed' && r.completedAt && r.startedAt);
      const avgDurationMs = completedRuns.length > 0
        ? Math.round(completedRuns.reduce((sum, r) => sum + ((r.completedAt ?? 0) - r.startedAt), 0) / completedRuns.length)
        : undefined;

      // Gate wait statistics
      const gateWaitStats = this.computeGateWaitStats(workflowRuns);

      // Failure type distribution
      const failureTypes = this.computeFailureTypeDistribution(workflowRuns);

      // Recent runs
      const recentRuns = this.buildRecentRunSummaries(workflowRuns, limit);

      // Eval summary (placeholder - would need eval data source)
      const evalSummary = this.computeEvalSummary(workflowRuns);

      return {
        workflowId,
        workflowName,
        totalRuns,
        successCount,
        failureCount,
        activeCount,
        successRate,
        failureRate,
        avgDurationMs,
        gateWaitStats,
        failureTypes,
        evalSummary,
        recentRuns,
        computedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get quality summaries for all workflows.
   */
  getAllWorkflowQualitySummaries(limit = 10): WorkflowQualitySummary[] {
    const allRuns = this.stateManager.listRuns();
    const workflowIds = [...new Set(allRuns.map(r => r.workflowId))];

    const summaries: WorkflowQualitySummary[] = [];
    for (const workflowId of workflowIds) {
      const summary = this.getWorkflowQualitySummary(workflowId, limit);
      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries;
  }

  // ===========================================================================
  // Private helper methods
  // ===========================================================================

  private loadWorkflowConfig(workflowId: string): WorkflowConfig | undefined {
    if (!this.configLoader) {
      return undefined;
    }
    try {
      return this.configLoader.loadWorkflow(workflowId);
    } catch {
      return undefined;
    }
  }

  private buildDependencyMap(
    workflowConfig?: WorkflowConfig,
  ): Map<string, string[]> {
    const map = new Map<string, string[]>();

    if (!workflowConfig) {
      return map;
    }

    for (const step of workflowConfig.steps) {
      map.set(step.id, step.depends_on ?? []);
    }

    return map;
  }

  private buildReverseDependencyMap(
    dependencyMap: Map<string, string[]>,
  ): Map<string, string[]> {
    const reverseMap = new Map<string, string[]>();

    // Initialize all nodes with empty arrays
    for (const nodeId of dependencyMap.keys()) {
      reverseMap.set(nodeId, []);
    }

    // Build reverse dependencies
    for (const [nodeId, dependencies] of dependencyMap.entries()) {
      for (const dep of dependencies) {
        const downstream = reverseMap.get(dep) ?? [];
        downstream.push(nodeId);
        reverseMap.set(dep, downstream);
      }
    }

    return reverseMap;
  }

  private buildStepNamesMap(
    workflowConfig?: WorkflowConfig,
  ): Map<string, string> {
    const map = new Map<string, string>();

    if (!workflowConfig) {
      return map;
    }

    for (const step of workflowConfig.steps) {
      const displayName = step.metadata?.displayName;
      map.set(step.id, displayName ?? step.id);
    }

    return map;
  }

  private buildFailedNodeDetails(
    steps: Record<string, { status: string; error?: string; startedAt?: number; completedAt?: number }>,
    failedNodeIds: string[],
    dependencyMap: Map<string, string[]>,
    stepNames: Map<string, string>,
  ): FailedNodeDetail[] {
    return failedNodeIds.map((nodeId) => {
      const step = steps[nodeId];
      const errorMsg = step?.error as string | undefined;
      const mapped = errorMsg ? ERROR_MAPPINGS.find((m) => m.pattern.test(errorMsg)) : undefined;

      // Find upstream status
      const upstream = dependencyMap.get(nodeId) ?? [];
      const upstreamCompleted: string[] = [];
      const upstreamFailed: string[] = [];

      for (const upId of upstream) {
        const upStep = steps[upId];
        if (upStep?.status === 'completed') {
          upstreamCompleted.push(upId);
        } else if (upStep?.status === 'failed') {
          upstreamFailed.push(upId);
        }
      }

      return {
        nodeId,
        nodeName: stepNames.get(nodeId),
        status: 'failed' as const,
        errorType: mapped?.type ?? 'UnknownError',
        errorMessage: errorMsg ?? 'Unknown error',
        failedAt: step?.completedAt,
        upstreamCompleted,
        upstreamFailed,
      };
    });
  }

  private buildDownstreamImpact(
    failedNodeIds: string[],
    reverseDependencyMap: Map<string, string[]>,
    steps: Record<string, { status: string }>,
    stepNames: Map<string, string>,
  ): DownstreamImpactNode[] {
    const impacted: DownstreamImpactNode[] = [];
    const visited = new Set<string>();

    // BFS to find all downstream nodes
    const queue = [...failedNodeIds];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const downstream = reverseDependencyMap.get(currentId) ?? [];
      for (const downId of downstream) {
        if (visited.has(downId)) {
          continue;
        }

        const downStep = steps[downId];
        const status = this.mapNodeStatus(downStep?.status);

        // Determine impact type
        let impactType: DownstreamImpactNode['impactType'];
        let reason: string;

        if (downStep?.status === 'skipped') {
          impactType = 'skipped';
          reason = `Skipped due to upstream failure at ${currentId}`;
        } else if (downStep?.status === 'failed') {
          impactType = 'will_fail';
          reason = `Failed, possibly due to upstream issue at ${currentId}`;
        } else {
          impactType = 'blocked';
          reason = `Blocked by upstream failure at ${currentId}`;
        }

        impacted.push({
          nodeId: downId,
          nodeName: stepNames.get(downId),
          status,
          impactType,
          reason,
        });

        queue.push(downId);
      }
    }

    return impacted;
  }

  private buildFailurePropagation(
    failedNodeIds: string[],
    downstreamImpact: DownstreamImpactNode[],
    dependencyMap: Map<string, string[]>,
  ): FailurePropagation | undefined {
    if (failedNodeIds.length === 0) {
      return undefined;
    }

    // Find the root cause (earliest failure in dependency chain)
    let rootCauseNodeId = failedNodeIds[0];

    // Check if any failed node has no failed upstream dependencies
    for (const failedId of failedNodeIds) {
      const upstream = dependencyMap.get(failedId) ?? [];
      const hasFailedUpstream = upstream.some((upId) => failedNodeIds.includes(upId));

      if (!hasFailedUpstream) {
        rootCauseNodeId = failedId;
        break;
      }
    }

    // Build propagation path
    const propagationPath = [rootCauseNodeId];
    const impactedIds = downstreamImpact
      .filter((n) => n.impactType === 'skipped' || n.impactType === 'will_fail')
      .map((n) => n.nodeId);
    propagationPath.push(...impactedIds);

    // Build summary
    const affectedCount = downstreamImpact.length;
    let summary: string;

    if (affectedCount === 0) {
      summary = `Failure at ${rootCauseNodeId} did not block any downstream nodes.`;
    } else if (affectedCount === 1) {
      summary = `Failure at ${rootCauseNodeId} blocked 1 downstream node.`;
    } else {
      summary = `Failure at ${rootCauseNodeId} blocked ${affectedCount} downstream nodes.`;
    }

    return {
      rootCauseNodeId,
      propagationPath,
      affectedNodeCount: affectedCount,
      summary,
    };
  }

  private buildRecommendedActions(
    runId: string,
    failedNodes: FailedNodeDetail[],
    downstreamImpact: DownstreamImpactNode[],
    errorSummary: ErrorSummary[],
    recoveryScope?: { reusedCount: number; rerunCount: number; riskLevel: 'low' | 'medium' | 'high'; summary: string },
  ): RecommendedAction[] {
    const actions: RecommendedAction[] = [];

    // Add recover action (M3) - only for failed runs with recoverable steps
    if (recoveryScope && recoveryScope.rerunCount > 0) {
      const riskLabel = recoveryScope.riskLevel === 'low' ? 'low risk' :
                        recoveryScope.riskLevel === 'medium' ? 'medium risk' : 'high risk';
      actions.push({
        type: 'recover',
        priority: 'high',
        title: 'Smart Recovery',
        description: `Reuse ${recoveryScope.reusedCount} completed step(s), re-run ${recoveryScope.rerunCount} failed step(s). ${recoveryScope.summary} (${riskLabel})`,
        targetRunId: runId,
      });
    }

    // Add rerun action
    if (failedNodes.length > 0) {
      actions.push({
        type: 'rerun',
        priority: 'high',
        title: 'Rerun from beginning',
        description: 'Start a new run with the same input to retry the entire workflow.',
        targetRunId: runId,
      });
    }

    // Add error-specific actions
    for (const error of errorSummary) {
      const mapping = ERROR_MAPPINGS.find((m) => m.pattern.test(error.errorMessage));

      if (mapping?.actionType === 'check_api') {
        actions.push({
          type: 'check_api',
          priority: 'high',
          title: 'Check API configuration',
          description: 'Verify your API key and endpoint configuration in Settings.',
          targetNodeId: error.nodeId,
        });
      } else if (mapping?.actionType === 'fix_config') {
        actions.push({
          type: 'fix_config',
          priority: 'high',
          title: 'Fix configuration',
          description: 'Review and fix the input data format or workflow configuration.',
          targetNodeId: error.nodeId,
        });
      } else if (mapping?.actionType === 'retry') {
        actions.push({
          type: 'retry',
          priority: 'medium',
          title: 'Retry after waiting',
          description: 'Wait a moment and try again. This may be a transient error.',
          targetNodeId: error.nodeId,
        });
      }
    }

    // Add rerun with edits if there are downstream impacts
    if (downstreamImpact.length > 0) {
      actions.push({
        type: 'rerun_with_edits',
        priority: 'medium',
        title: 'Rerun with adjustments',
        description: 'Modify the input or configuration before rerunning to avoid the same failure.',
        targetRunId: runId,
      });
    }

    // Add contact support as fallback
    if (actions.length === 0) {
      actions.push({
        type: 'contact_support',
        priority: 'low',
        title: 'Get help',
        description: 'If the issue persists, check the documentation or seek support.',
      });
    }

    // Deduplicate by type
    const seenTypes = new Set<RecommendedAction['type']>();
    return actions.filter((action) => {
      if (seenTypes.has(action.type)) {
        return false;
      }
      seenTypes.add(action.type);
      return true;
    });
  }

  /**
   * Compute recovery scope for a failed run.
   * This is a simplified version of the recovery analysis that provides
   * a quick preview without full dependency resolution.
   */
  private computeRecoveryScope(
    run: RunState,
    workflowConfig?: WorkflowConfig,
  ): { reusedCount: number; rerunCount: number; invalidatedCount: number; riskLevel: 'low' | 'medium' | 'high'; summary: string } | undefined {
    if (run.status !== 'failed') {
      return undefined;
    }

    // Find failed node IDs
    const failedNodeIds = this.findFailedNodeIds(run.steps);
    if (failedNodeIds.length === 0) {
      return undefined;
    }

    const classification = classifyRecoverySteps(run.steps, workflowConfig?.steps ?? [], {
      resumeFromStep: failedNodeIds[0],
      requireOutputForReuse: false,
    });
    const reusedCount = classification.reused.length;
    const rerunCount = classification.rerun.length + classification.invalidated.length;
    const invalidatedCount = classification.invalidated.length;

    // Calculate risk level based on rerun ratio
    const totalRelevant = reusedCount + rerunCount;
    const rerunRatio = totalRelevant > 0 ? rerunCount / totalRelevant : 0;

    // Check for gate warnings
    let hasGateWarning = false;
    if (workflowConfig) {
      for (const stepId of [...classification.rerun, ...classification.invalidated].map((step) => step.stepId)) {
        const stepConfig = workflowConfig.steps.find((s) => s.id === stepId);
        if (stepConfig?.gate === 'approve') {
          hasGateWarning = true;
          break;
        }
      }
    }

    let riskLevel: 'low' | 'medium' | 'high';
    if (rerunRatio > 0.5 || hasGateWarning) {
      riskLevel = 'high';
    } else if (rerunRatio < 0.2 && !hasGateWarning) {
      riskLevel = 'low';
    } else {
      riskLevel = 'medium';
    }

    // Generate summary
    let summary: string;
    if (reusedCount === 0 && rerunCount === 0) {
      summary = 'No steps to recover';
    } else if (reusedCount === 0) {
      summary = `All ${rerunCount} step(s) will be re-executed`;
    } else if (rerunCount === 0) {
      summary = `All ${reusedCount} step(s) can be reused`;
    } else {
      summary = `${reusedCount} step(s) reused, ${rerunCount} step(s) will execute again`;
    }

    return { reusedCount, rerunCount, invalidatedCount, riskLevel, summary };
  }

  private mapNodeStatus(status?: string): NodeStatus {
    const statusMap: Record<string, NodeStatus> = {
      pending: 'pending',
      running: 'running',
      completed: 'completed',
      failed: 'failed',
      skipped: 'skipped',
      gate_waiting: 'gate_waiting',
    };
    return statusMap[status ?? 'pending'] ?? 'pending';
  }

  private findFailedNodeId(steps: Record<string, { status: string }>): string | undefined {
    for (const [stepId, step] of Object.entries(steps)) {
      if (step.status === 'failed') {
        return stepId;
      }
    }
    return undefined;
  }

  private findFailedNodeIds(steps: Record<string, { status: string }>): string[] {
    return Object.entries(steps)
      .filter(([, step]) => step.status === 'failed')
      .map(([stepId]) => stepId);
  }

  private findGateWaitingNodeIds(steps: Record<string, { status: string }>): string[] {
    return Object.entries(steps)
      .filter(([, step]) => step.status === 'gate_waiting')
      .map(([stepId]) => stepId);
  }

  private extractErrorInfo(steps: Record<string, { status: string; error?: string }>): {
    type?: string;
    message?: string;
  } {
    for (const step of Object.values(steps)) {
      if (step.status === 'failed' && step.error) {
        const errorMsg = step.error as string;
        const mapped = ERROR_MAPPINGS.find((m) => m.pattern.test(errorMsg));
        return {
          type: mapped?.type ?? 'UnknownError',
          message: errorMsg,
        };
      }
    }
    return {};
  }

  private buildErrorSummary(
    steps: Record<string, { status: string; error?: string }>,
  ): ErrorSummary[] {
    const summaries: ErrorSummary[] = [];

    for (const [stepId, step] of Object.entries(steps)) {
      if (step.status === 'failed' && step.error) {
        const errorMsg = step.error as string;
        const mapped = ERROR_MAPPINGS.find((m) => m.pattern.test(errorMsg));
        summaries.push({
          nodeId: stepId,
          errorType: mapped?.type ?? 'UnknownError',
          errorMessage: errorMsg,
          suggestedActions: mapped?.suggestedActions ?? this.getSuggestedActions(errorMsg),
        });
      }
    }

    return summaries;
  }

  private buildUpstreamStates(
    steps: Record<string, { status: string }>,
  ): Record<string, NodeStatus> {
    const states: Record<string, NodeStatus> = {};

    for (const [stepId, step] of Object.entries(steps)) {
      states[stepId] = this.mapNodeStatus(step.status);
    }

    return states;
  }

  private computeGateWaitStats(
    runs: Array<{ runId: string; status: string; steps: Record<string, { status: string; startedAt?: number }> }>,
  ): GateWaitStats {
    let totalGateWaits = 0;
    let runsWithGateWait = 0;
    let lastGateWaitAt: number | undefined;

    for (const run of runs) {
      let runGateWaitCount = 0;
      for (const step of Object.values(run.steps)) {
        if (step.status === 'gate_waiting') {
          totalGateWaits++;
          runGateWaitCount++;
          if (step.startedAt && (!lastGateWaitAt || step.startedAt > lastGateWaitAt)) {
            lastGateWaitAt = step.startedAt;
          }
        }
      }
      if (runGateWaitCount > 0) {
        runsWithGateWait++;
      }
    }

    return { totalGateWaits, runsWithGateWait, lastGateWaitAt };
  }

  private computeFailureTypeDistribution(
    runs: Array<{ steps: Record<string, { status: string; error?: string }> }>,
  ): FailureTypeDistribution[] {
    const errorTypeCounts = new Map<string, number>();
    let totalFailedRuns = 0;

    for (const run of runs) {
      if (run.steps) {
        for (const step of Object.values(run.steps)) {
          if (step.status === 'failed' && step.error) {
            const errorType = this.classifyError(step.error as string);
            errorTypeCounts.set(errorType, (errorTypeCounts.get(errorType) ?? 0) + 1);
          }
        }
      }
    }

    totalFailedRuns = Array.from(errorTypeCounts.values()).reduce((sum, count) => sum + count, 0);

    const distribution: FailureTypeDistribution[] = [];
    for (const [errorType, count] of errorTypeCounts.entries()) {
      distribution.push({
        errorType,
        count,
        percentage: totalFailedRuns > 0 ? Math.round((count / totalFailedRuns) * 10000) / 100 : 0,
      });
    }

    // Sort by count descending
    distribution.sort((a, b) => b.count - a.count);

    return distribution;
  }

  private classifyError(errorMessage: string): string {
    for (const mapping of ERROR_MAPPINGS) {
      if (mapping.pattern.test(errorMessage)) {
        return mapping.type;
      }
    }
    return 'UnknownError';
  }

  private buildRecentRunSummaries(
    runs: Array<{ runId: string; status: string; startedAt: number; completedAt?: number; steps: Record<string, { status: string; error?: string }> }>,
    limit: number,
  ): QualityRunSummary[] {
    // Sort by startedAt descending
    const sorted = [...runs].sort((a, b) => b.startedAt - a.startedAt);

    return sorted.slice(0, limit).map(run => {
      let errorType: string | undefined;
      if (run.status === 'failed') {
        for (const step of Object.values(run.steps)) {
          if (step.status === 'failed' && step.error) {
            errorType = this.classifyError(step.error as string);
            break;
          }
        }
      }

      return {
        runId: run.runId,
        status: run.status as QualityRunSummary['status'],
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs: run.completedAt ? run.completedAt - run.startedAt : undefined,
        errorType,
      };
    });
  }

  private computeEvalSummary(
    runs: Array<{ runId: string; status: string }>,
  ): EvalSummary | undefined {
    // This is a placeholder - in a real implementation, we would load eval data
    // from eval results stored for each run. For now, return undefined to indicate
    // eval data is not available.
    // TODO: Integrate with eval runner to load actual eval scores
    return undefined;
  }
}
