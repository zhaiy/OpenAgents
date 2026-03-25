import { StateManager } from '../../engine/state.js';
import type {
  NodeStatus,
  RunNodeStateDto,
  RunVisualStateDto,
  TimelineEntry,
} from '../dto.js';
import type { TokenUsage } from '../dto.js';
import type { RunEventEmitter } from '../events/run-event-emitter.js';
import { aggregateTokenUsageOptional } from './run-metrics.js';

export class RunVisualService {
  constructor(
    private readonly stateManager: StateManager,
    private readonly eventEmitter?: RunEventEmitter,
  ) {}

  /**
   * Get visual state for a run
   */
  getVisualState(runId: string): RunVisualStateDto {
    const run = this.stateManager.findRunById(runId);

    const nodeStates: Record<string, RunNodeStateDto> = {};
    const currentActiveNodeIds: string[] = [];
    const gateWaitingNodeIds: string[] = [];
    const failedNodeIds: string[] = [];

    for (const [stepId, stepState] of Object.entries(run.steps)) {
      const status = this.mapStepStatus(stepState.status);
      nodeStates[stepId] = {
        nodeId: stepId,
        status,
        inputPreview: this.buildInputPreview(run.input, run.inputData),
        startedAt: stepState.startedAt,
        completedAt: stepState.completedAt,
        durationMs: stepState.durationMs,
        errorMessage: stepState.error,
        tokenUsage: stepState.tokenUsage as TokenUsage | undefined,
        retryCount: stepState.retryCount,
      };

      // Categorize nodes
      if (status === 'running' || status === 'streaming') {
        currentActiveNodeIds.push(stepId);
      } else if (status === 'gate_waiting') {
        gateWaitingNodeIds.push(stepId);
      } else if (status === 'failed') {
        failedNodeIds.push(stepId);
      }
    }

    // Calculate total token usage
    const totalTokenUsage = aggregateTokenUsageOptional(run.steps);

    // Get current sequence from event emitter for accurate lastEventId
    const currentSequence = this.eventEmitter?.getCurrentSequence(runId) ?? 0;
    const lastEventId = `${runId}:${currentSequence}`;

    return {
      runId: run.runId,
      workflowId: run.workflowId,
      status: run.status,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.completedAt
        ? run.completedAt - run.startedAt
        : undefined,
      nodeStates,
      currentActiveNodeIds,
      gateWaitingNodeIds,
      failedNodeIds,
      tokenUsage: totalTokenUsage,
      version: currentSequence + 1, // Version increments with each event
      lastEventId,
    };
  }

  /**
   * Get visual state for a specific node
   */
  getNodeState(runId: string, nodeId: string): RunNodeStateDto | null {
    const run = this.stateManager.findRunById(runId);
    const stepState = run.steps[nodeId];

    if (!stepState) return null;

    return {
      nodeId,
      status: this.mapStepStatus(stepState.status),
      inputPreview: this.buildInputPreview(run.input, run.inputData),
      startedAt: stepState.startedAt,
      completedAt: stepState.completedAt,
      durationMs: stepState.durationMs,
      errorMessage: stepState.error,
      tokenUsage: stepState.tokenUsage as TokenUsage | undefined,
      retryCount: stepState.retryCount,
    };
  }

  /**
   * Get timeline entries for a run
   */
  getTimeline(runId: string): TimelineEntry[] {
    const run = this.stateManager.findRunById(runId);
    const entries: TimelineEntry[] = [];

    // Add workflow started entry
    entries.push({
      id: `workflow.started:${runId}`,
      event: 'Workflow started',
      timestamp: run.startedAt,
      status: 'info',
    });

    // Add step entries
    for (const [stepId, stepState] of Object.entries(run.steps)) {
      if (stepState.startedAt) {
        entries.push({
          id: `step.started:${stepId}:${stepState.startedAt}`,
          event: `Step started`,
          timestamp: stepState.startedAt,
          stepId,
          details: stepId,
          status: 'info',
        });
      }

      if (stepState.completedAt) {
        const status: TimelineEntry['status'] =
          stepState.status === 'completed'
            ? 'success'
            : stepState.status === 'failed'
              ? 'error'
              : stepState.status === 'skipped'
                ? 'warning'
                : 'info';

        entries.push({
          id: `step.${stepState.status}:${stepId}:${stepState.completedAt}`,
          event:
            stepState.status === 'completed'
              ? 'Step completed'
              : stepState.status === 'failed'
                ? 'Step failed'
                : `Step ${stepState.status}`,
          timestamp: stepState.completedAt,
          stepId,
          details: stepState.error,
          status,
        });
      }
    }

    // Add workflow completed entry
    if (run.completedAt) {
      const status: TimelineEntry['status'] =
        run.status === 'completed'
          ? 'success'
          : run.status === 'failed'
            ? 'error'
            : 'warning';

      entries.push({
        id: `workflow.${run.status}:${runId}`,
        event:
          run.status === 'completed'
            ? 'Workflow completed'
            : run.status === 'failed'
              ? 'Workflow failed'
              : `Workflow ${run.status}`,
        timestamp: run.completedAt,
        status,
      });
    }

    // Sort by timestamp
    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Map internal step status to visual node status
   */
  private mapStepStatus(status: string): NodeStatus {
    const statusMap: Record<string, NodeStatus> = {
      pending: 'pending',
      queued: 'queued',
      running: 'running',
      streaming: 'streaming',
      gate_waiting: 'gate_waiting',
      completed: 'completed',
      failed: 'failed',
      skipped: 'skipped',
      cached: 'cached',
    };
    return statusMap[status] ?? 'pending';
  }

  private buildInputPreview(input: string, inputData?: Record<string, unknown>): string | undefined {
    const source = inputData && Object.keys(inputData).length > 0 ? JSON.stringify(inputData, null, 2) : input;
    if (!source) {
      return undefined;
    }
    const maxLength = 500;
    return source.length > maxLength ? `${source.slice(0, maxLength)}...` : source;
  }
}
