import { StateManager } from '../../engine/state.js';
import { randomUUID } from 'node:crypto';
import type {
  ComparisonSummary,
  DurationDiff,
  InputDiff,
  InputDiffType,
  NodeStatusDiff,
  OutputDiffItem,
  RunComparisonDto,
  RunComparisonSessionDto,
  TokenUsage,
} from '../dto.js';
import { aggregateTokenUsage, computeDurationOrNow, computePercentChange } from './run-metrics.js';

/**
 * Default session TTL: 30 minutes
 */
const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * Maximum output preview length
 */
const MAX_OUTPUT_PREVIEW_LENGTH = 200;

/**
 * Service for comparing runs and managing comparison sessions.
 *
 * N7 Enhancement:
 * - Structured input diff with types
 * - Node-level duration and error comparison
 * - Output diff with previews
 * - Comparison summary with recommendations
 * - Session TTL management
 */
export class RunCompareService {
  private readonly sessions = new Map<string, RunComparisonSessionDto>();
  private readonly sessionTtl: number;

  constructor(
    private readonly stateManager: StateManager,
    sessionTtl: number = DEFAULT_SESSION_TTL_MS,
  ) {
    this.sessionTtl = sessionTtl;
  }

  /**
   * Compare two runs with enhanced analysis.
   */
  compare(runAId: string, runBId: string): RunComparisonDto {
    const runA = this.stateManager.findRunById(runAId);
    const runB = this.stateManager.findRunById(runBId);

    // Compute all diffs
    const inputDiff = this.computeInputDiff(runA.inputData, runB.inputData);
    const inputDiffSummary = this.computeInputDiffSummary(inputDiff, runA.inputData, runB.inputData);
    const nodeStatusDiff = this.computeNodeStatusDiff(runA.steps, runB.steps);
    const nodeDiffSummary = this.computeNodeDiffSummary(runA.steps, runB.steps, nodeStatusDiff);
    const durationDiff = this.computeDurationDiff(runA, runB);
    const tokenUsageDiff = this.computeTokenUsageDiff(runA.steps, runB.steps);
    const outputDiff = this.computeOutputDiff(runA.steps, runB.steps);
    const workflowInfo = this.computeWorkflowInfo(runA, runB);

    // Generate summary
    const summary = this.generateSummary(
      inputDiff,
      inputDiffSummary,
      nodeStatusDiff,
      nodeDiffSummary,
      durationDiff,
      tokenUsageDiff,
      runA,
      runB,
    );

    return {
      runAId,
      runBId,
      workflowInfo,
      inputDiff: inputDiff.length > 0 ? inputDiff : undefined,
      inputDiffSummary,
      statusDiff: {
        runA: runA.status,
        runB: runB.status,
      },
      nodeStatusDiff: nodeStatusDiff.length > 0 ? nodeStatusDiff : undefined,
      nodeDiffSummary,
      durationDiff,
      tokenUsageDiff,
      outputDiff: outputDiff.length > 0 ? outputDiff : undefined,
      summary,
    };
  }

  /**
   * Create a new comparison session with TTL.
   */
  createSession(runAId: string, runBId: string): RunComparisonSessionDto {
    // Clean up expired sessions first
    this.cleanupExpiredSessions();

    const now = Date.now();
    const session: RunComparisonSessionDto = {
      sessionId: randomUUID(),
      createdAt: now,
      ttl: this.sessionTtl,
      expiresAt: now + this.sessionTtl,
      comparison: this.compare(runAId, runBId),
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  /**
   * Get a session by ID. Returns null if expired or not found.
   */
  getSession(sessionId: string): RunComparisonSessionDto | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check expiration
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Delete a session.
   */
  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  /**
   * Clean up all expired sessions.
   */
  cleanupExpiredSessions(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get active session count.
   */
  getActiveSessionCount(): number {
    this.cleanupExpiredSessions();
    return this.sessions.size;
  }

  // ===========================================================================
  // Private helper methods
  // ===========================================================================

  private computeWorkflowInfo(
    runA: { workflowId: string; workflowName?: string },
    runB: { workflowId: string; workflowName?: string },
  ): RunComparisonDto['workflowInfo'] {
    const isSameWorkflow = runA.workflowId === runB.workflowId;
    return {
      workflowId: runA.workflowId,
      name: runA.workflowName || runA.workflowId,
      isSameWorkflow,
    };
  }

  private computeInputDiff(
    inputDataA?: Record<string, unknown>,
    inputDataB?: Record<string, unknown>,
  ): InputDiff[] {
    const diffs: InputDiff[] = [];
    const keysA = new Set(Object.keys(inputDataA ?? {}));
    const keysB = new Set(Object.keys(inputDataB ?? {}));
    const allKeys = new Set([...keysA, ...keysB]);

    for (const key of allKeys) {
      const valueA = inputDataA?.[key];
      const valueB = inputDataB?.[key];
      const hasA = keysA.has(key);
      const hasB = keysB.has(key);

      let diffType: InputDiffType;
      let typeA: string | undefined;
      let typeB: string | undefined;

      if (!hasA && hasB) {
        diffType = 'added';
      } else if (hasA && !hasB) {
        diffType = 'removed';
      } else {
        const typeOfA = typeof valueA;
        const typeOfB = typeof valueB;

        if (typeOfA !== typeOfB) {
          diffType = 'type_changed';
          typeA = typeOfA;
          typeB = typeOfB;
        } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
          diffType = 'changed';
        } else {
          continue; // No difference
        }
      }

      diffs.push({
        field: key,
        valueA: hasA ? valueA : undefined,
        valueB: hasB ? valueB : undefined,
        diffType,
        typeA,
        typeB,
      });
    }

    return diffs;
  }

  private computeInputDiffSummary(
    diffs: InputDiff[],
    inputDataA?: Record<string, unknown>,
    inputDataB?: Record<string, unknown>,
  ): RunComparisonDto['inputDiffSummary'] {
    const keysA = new Set(Object.keys(inputDataA ?? {}));
    const keysB = new Set(Object.keys(inputDataB ?? {}));
    const allKeys = new Set([...keysA, ...keysB]);

    let added = 0;
    let removed = 0;
    let changed = 0;

    for (const diff of diffs) {
      switch (diff.diffType) {
        case 'added':
          added++;
          break;
        case 'removed':
          removed++;
          break;
        case 'changed':
        case 'type_changed':
          changed++;
          break;
      }
    }

    const unchanged = allKeys.size - added - removed - changed;

    return { added, removed, changed, unchanged };
  }

  private computeNodeStatusDiff(
    stepsA: Record<string, { status: string; startedAt?: number; completedAt?: number; errorMessage?: string }>,
    stepsB: Record<string, { status: string; startedAt?: number; completedAt?: number; errorMessage?: string }>,
  ): NodeStatusDiff[] {
    const diffs: NodeStatusDiff[] = [];
    const keysA = new Set(Object.keys(stepsA));
    const keysB = new Set(Object.keys(stepsB));
    const allKeys = new Set([...keysA, ...keysB]);

    for (const key of allKeys) {
      const stepA = stepsA[key];
      const stepB = stepsB[key];

      // Skip nodes that only exist in one run for now (handled in summary)
      if (!stepA || !stepB) continue;

      const statusA = stepA.status as NodeStatusDiff['statusA'];
      const statusB = stepB.status as NodeStatusDiff['statusB'];

      // Compute duration diff
      const durationA = stepA.startedAt && stepA.completedAt
        ? stepA.completedAt - stepA.startedAt
        : undefined;
      const durationB = stepB.startedAt && stepB.completedAt
        ? stepB.completedAt - stepB.startedAt
        : undefined;

      const hasDurationDiff = durationA !== undefined && durationB !== undefined && durationA !== durationB;

      // Check if status differs or has significant duration diff
      if (statusA !== statusB || hasDurationDiff) {
        const isCritical = statusA === 'failed' || statusB === 'failed';

        diffs.push({
          nodeId: key,
          statusA,
          statusB,
          durationDiff: hasDurationDiff
            ? { runA: durationA, runB: durationB, delta: durationB! - durationA! }
            : undefined,
          errorA: stepA.errorMessage,
          errorB: stepB.errorMessage,
          isCritical,
        });
      }
    }

    return diffs;
  }

  private computeNodeDiffSummary(
    stepsA: Record<string, unknown>,
    stepsB: Record<string, unknown>,
    diffs: NodeStatusDiff[],
  ): RunComparisonDto['nodeDiffSummary'] {
    const keysA = new Set(Object.keys(stepsA));
    const keysB = new Set(Object.keys(stepsB));
    const allKeys = new Set([...keysA, ...keysB]);
    const onlyInA = keysA.size - [...keysA].filter((k) => keysB.has(k)).length;
    const onlyInB = keysB.size - [...keysB].filter((k) => keysA.has(k)).length;

    return {
      totalNodes: allKeys.size,
      identical: allKeys.size - diffs.length - onlyInA - onlyInB,
      different: diffs.length,
      onlyInA,
      onlyInB,
    };
  }

  private computeDurationDiff(
    runA: { startedAt: number; completedAt?: number },
    runB: { startedAt: number; completedAt?: number },
  ): DurationDiff | undefined {
    const durationA = computeDurationOrNow(runA.startedAt, runA.completedAt);
    const durationB = computeDurationOrNow(runB.startedAt, runB.completedAt);

    if (durationA === durationB) return undefined;

    const delta = durationB - durationA;
    const percentChange = computePercentChange(durationB, durationA);

    return {
      runA: durationA,
      runB: durationB,
      delta,
      percentChange,
    };
  }

  private computeTokenUsageDiff(
    stepsA: Record<string, { tokenUsage?: TokenUsage }>,
    stepsB: Record<string, { tokenUsage?: TokenUsage }>,
  ): RunComparisonDto['tokenUsageDiff'] | undefined {
    const usageA = this.sumTokenUsage(stepsA);
    const usageB = this.sumTokenUsage(stepsB);

    if (!usageA && !usageB) return undefined;
    if (!usageA || !usageB) {
      return {
        runA: usageA ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        runB: usageB ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    }

    if (
      usageA.promptTokens === usageB.promptTokens &&
      usageA.completionTokens === usageB.completionTokens &&
      usageA.totalTokens === usageB.totalTokens
    ) {
      return undefined;
    }

    const delta = usageA.totalTokens - usageB.totalTokens;
    const percentChange = usageB.totalTokens > 0 ? (delta / usageB.totalTokens) * 100 : undefined;

    return {
      runA: usageA,
      runB: usageB,
      delta,
      percentChange,
    };
  }

  private computeOutputDiff(
    stepsA: Record<string, { status: string; output?: string; outputFile?: string }>,
    stepsB: Record<string, { status: string; output?: string; outputFile?: string }>,
  ): OutputDiffItem[] {
    const diffs: OutputDiffItem[] = [];
    const keysA = new Set(Object.keys(stepsA));
    const keysB = new Set(Object.keys(stepsB));
    const allKeys = new Set([...keysA, ...keysB]);

    for (const key of allKeys) {
      const stepA = stepsA[key];
      const stepB = stepsB[key];

      const hasOutputA = Boolean(stepA?.output || stepA?.outputFile);
      const hasOutputB = Boolean(stepB?.output || stepB?.outputFile);

      // Only include if there's a difference
      if (hasOutputA !== hasOutputB || (hasOutputA && hasOutputB)) {
        const previewA = stepA?.output
          ? this.truncatePreview(stepA.output)
          : stepA?.outputFile
            ? `[file: ${stepA.outputFile}]`
            : undefined;
        const previewB = stepB?.output
          ? this.truncatePreview(stepB.output)
          : stepB?.outputFile
              ? `[file: ${stepB.outputFile}]`
              : undefined;

        const isIdentical = previewA === previewB;

        // Only add if there's an actual difference
        if (!isIdentical || hasOutputA !== hasOutputB) {
          diffs.push({
            nodeId: key,
            hasOutputA,
            hasOutputB,
            previewA,
            previewB,
            isIdentical,
          });
        }
      }
    }

    return diffs;
  }

  private generateSummary(
    inputDiff: InputDiff[],
    inputDiffSummary: RunComparisonDto['inputDiffSummary'],
    nodeStatusDiff: NodeStatusDiff[],
    nodeDiffSummary: RunComparisonDto['nodeDiffSummary'],
    durationDiff: DurationDiff | undefined,
    tokenUsageDiff: RunComparisonDto['tokenUsageDiff'] | undefined,
    runA: { status: string },
    runB: { status: string },
  ): ComparisonSummary {
    const keyDifferences: string[] = [];
    const recommendations: string[] = [];
    const warnings: string[] = [];

    // Input differences
    if (inputDiffSummary) {
      if (inputDiffSummary.added > 0) {
        keyDifferences.push(`Run B has ${inputDiffSummary.added} new input field(s)`);
      }
      if (inputDiffSummary.removed > 0) {
        keyDifferences.push(`Run B removed ${inputDiffSummary.removed} input field(s)`);
      }
      if (inputDiffSummary.changed > 0) {
        keyDifferences.push(`${inputDiffSummary.changed} input field(s) changed`);
      }
    }

    // Node differences
    if (nodeDiffSummary) {
      if (nodeDiffSummary.different > 0) {
        keyDifferences.push(`${nodeDiffSummary.different} node(s) have different status`);
      }
      if (nodeDiffSummary.onlyInA > 0 || nodeDiffSummary.onlyInB > 0) {
        keyDifferences.push(`Different node structure between runs`);
      }
    }

    // Duration differences
    if (durationDiff) {
      const direction = durationDiff.delta > 0 ? 'slower' : 'faster';
      const absChange = Math.abs(durationDiff.percentChange || 0).toFixed(1);
      keyDifferences.push(`Run B is ${absChange}% ${direction} (${this.formatDuration(Math.abs(durationDiff.delta))})`);
    }

    // Token usage differences
    if (tokenUsageDiff?.delta) {
      const direction = tokenUsageDiff.delta > 0 ? 'more' : 'fewer';
      keyDifferences.push(`Run A used ${Math.abs(tokenUsageDiff.delta)} ${direction} tokens`);
    }

    // Status-based warnings
    if (runA.status === 'completed' && runB.status === 'failed') {
      warnings.push('Run B failed while Run A completed successfully');
      recommendations.push('Review the failure in Run B before proceeding');
    } else if (runA.status === 'failed' && runB.status === 'completed') {
      recommendations.push('Run B appears to have fixed the issue from Run A');
    } else if (runA.status === 'failed' && runB.status === 'failed') {
      warnings.push('Both runs failed - consider reviewing the workflow configuration');
    }

    // Critical node warnings
    const criticalNodes = nodeStatusDiff.filter((n) => n.isCritical);
    if (criticalNodes.length > 0) {
      warnings.push(`${criticalNodes.length} critical node(s) have different status`);
    }

    // Calculate similarity score
    let score = 100;

    // Deduct for input differences
    if (inputDiffSummary) {
      const totalInputFields = inputDiffSummary.added + inputDiffSummary.removed +
        inputDiffSummary.changed + inputDiffSummary.unchanged;
      if (totalInputFields > 0) {
        const inputDiffRatio = (inputDiffSummary.added + inputDiffSummary.removed + inputDiffSummary.changed) / totalInputFields;
        score -= inputDiffRatio * 20;
      }
    }

    // Deduct for node differences
    if (nodeDiffSummary && nodeDiffSummary.totalNodes > 0) {
      const nodeDiffRatio = nodeDiffSummary.different / nodeDiffSummary.totalNodes;
      score -= nodeDiffRatio * 30;
    }

    // Deduct for status differences
    if (runA.status !== runB.status) {
      score -= 25;
    }

    // Deduct for duration differences (significant = >20%)
    if (durationDiff && durationDiff.percentChange) {
      if (Math.abs(durationDiff.percentChange) > 20) {
        score -= 10;
      }
    }

    // Ensure score is in valid range
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      similarityScore: score,
      keyDifferences,
      recommendations,
      warnings,
    };
  }

  private sumTokenUsage(
    steps: Record<string, { tokenUsage?: TokenUsage }>,
  ): TokenUsage | undefined {
    const aggregated = aggregateTokenUsage(steps);
    if (!aggregated.hasUsage || aggregated.totalTokens === 0) {
      return undefined;
    }
    return {
      promptTokens: aggregated.promptTokens,
      completionTokens: aggregated.completionTokens,
      totalTokens: aggregated.totalTokens,
    };
  }

  private truncatePreview(text: string): string {
    if (text.length <= MAX_OUTPUT_PREVIEW_LENGTH) {
      return text;
    }
    return text.substring(0, MAX_OUTPUT_PREVIEW_LENGTH) + '...';
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }
}