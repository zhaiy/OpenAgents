/**
 * Run Metrics Utilities
 *
 * Shared utilities for aggregating run-level metrics including token usage
 * and duration. These utilities provide a consistent calculation口径 across
 * all services.
 *
 * M7: Statistics and aggregation layer cleanup - provides unified entry point
 * for third-phase trend analysis.
 */

import type { TokenUsage } from '../dto.js';

/**
 * Result of aggregating token usage across multiple steps.
 */
export interface AggregatedTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Whether any step actually had token usage data */
  hasUsage: boolean;
}

/**
 * Aggregate token usage from multiple steps.
 * Returns a consistent result with hasUsage flag to distinguish
 * "no data" from "actual zero usage".
 */
export function aggregateTokenUsage(
  steps: Record<string, { tokenUsage?: TokenUsage }> | Array<{ tokenUsage?: TokenUsage }>,
): AggregatedTokenUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let hasUsage = false;

  const stepValues = Array.isArray(steps) ? steps : Object.values(steps);

  for (const step of stepValues) {
    if (step.tokenUsage) {
      hasUsage = true;
      promptTokens += step.tokenUsage.promptTokens ?? 0;
      completionTokens += step.tokenUsage.completionTokens ?? 0;
      totalTokens += step.tokenUsage.totalTokens ?? 0;
    }
  }

  return { promptTokens, completionTokens, totalTokens, hasUsage };
}

/**
 * Compute duration from start and completion timestamps.
 * Returns undefined if completedAt is not available.
 */
export function computeDuration(
  startedAt: number,
  completedAt?: number,
): number | undefined {
  if (completedAt === undefined) {
    return undefined;
  }
  return completedAt - startedAt;
}

/**
 * Compute duration with fallback to current time for running steps.
 */
export function computeDurationOrNow(
  startedAt: number,
  completedAt?: number,
): number {
  return completedAt ? completedAt - startedAt : Date.now() - startedAt;
}

/**
 * Compute percentage change between two values.
 * Returns undefined if base is 0.
 */
export function computePercentChange(
  newValue: number,
  baseValue: number,
): number | undefined {
  if (baseValue === 0) {
    return undefined;
  }
  return ((newValue - baseValue) / baseValue) * 100;
}

/**
 * Run status counts for aggregating multiple runs.
 */
export interface RunStatusCounts {
  total: number;
  completed: number;
  failed: number;
  running: number;
  interrupted: number;
}

/**
 * Aggregate run counts by status.
 */
export function aggregateRunStatusCounts(
  runs: Array<{ status: 'completed' | 'failed' | 'running' | 'interrupted' | string }>,
): RunStatusCounts {
  const counts: RunStatusCounts = {
    total: runs.length,
    completed: 0,
    failed: 0,
    running: 0,
    interrupted: 0,
  };

  for (const run of runs) {
    switch (run.status) {
      case 'completed':
        counts.completed++;
        break;
      case 'failed':
        counts.failed++;
        break;
      case 'running':
        counts.running++;
        break;
      case 'interrupted':
        counts.interrupted++;
        break;
    }
  }

  return counts;
}
