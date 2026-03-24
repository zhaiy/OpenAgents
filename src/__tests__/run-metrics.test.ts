import { describe, it, expect } from 'vitest';
import {
  aggregateTokenUsage,
  computeDuration,
  computeDurationOrNow,
  computePercentChange,
  aggregateRunStatusCounts,
} from '../app/services/run-metrics.js';
import type { TokenUsage } from '../app/dto.js';

describe('run-metrics utilities (M7)', () => {
  describe('aggregateTokenUsage', () => {
    it('should return zero usage for empty steps', () => {
      const result = aggregateTokenUsage({});
      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.hasUsage).toBe(false);
    });

    it('should aggregate token usage from multiple steps', () => {
      const steps = {
        step1: { tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
        step2: { tokenUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } },
      };
      const result = aggregateTokenUsage(steps);
      expect(result.promptTokens).toBe(300);
      expect(result.completionTokens).toBe(150);
      expect(result.totalTokens).toBe(450);
      expect(result.hasUsage).toBe(true);
    });

    it('should handle missing token fields with defaults', () => {
      const steps = {
        step1: { tokenUsage: { totalTokens: 100 } as TokenUsage },
      };
      const result = aggregateTokenUsage(steps);
      expect(result.promptTokens).toBe(0);
      expect(result.completionTokens).toBe(0);
      expect(result.totalTokens).toBe(100);
      expect(result.hasUsage).toBe(true);
    });

    it('should accept array input', () => {
      const steps = [
        { tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
        { tokenUsage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 } },
      ];
      const result = aggregateTokenUsage(steps);
      expect(result.totalTokens).toBe(450);
    });

    it('should skip steps without token usage', () => {
      const steps = {
        step1: { tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } },
        step2: {},
      };
      const result = aggregateTokenUsage(steps);
      expect(result.totalTokens).toBe(150);
      expect(result.hasUsage).toBe(true);
    });
  });

  describe('computeDuration', () => {
    it('should compute duration from start and end times', () => {
      const result = computeDuration(1000, 5000);
      expect(result).toBe(4000);
    });

    it('should return undefined when completedAt is missing', () => {
      const result = computeDuration(1000, undefined);
      expect(result).toBeUndefined();
    });

    it('should return zero when start and end are equal', () => {
      const result = computeDuration(1000, 1000);
      expect(result).toBe(0);
    });
  });

  describe('computeDurationOrNow', () => {
    it('should compute duration when completedAt is provided', () => {
      const result = computeDurationOrNow(1000, 5000);
      expect(result).toBe(4000);
    });

    it('should use current time when completedAt is missing', () => {
      const before = Date.now();
      const result = computeDurationOrNow(before, undefined);
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(after - before + 1);
    });
  });

  describe('computePercentChange', () => {
    it('should compute percent change correctly', () => {
      // (150 - 100) / 100 * 100 = 50%
      const result = computePercentChange(150, 100);
      expect(result).toBe(50);
    });

    it('should handle negative change', () => {
      // (50 - 100) / 100 * 100 = -50%
      const result = computePercentChange(50, 100);
      expect(result).toBe(-50);
    });

    it('should return undefined when base value is zero', () => {
      const result = computePercentChange(100, 0);
      expect(result).toBeUndefined();
    });

    it('should handle fractional percentages', () => {
      // (110 - 100) / 100 * 100 = 10%
      const result = computePercentChange(110, 100);
      expect(result).toBe(10);
    });
  });

  describe('aggregateRunStatusCounts', () => {
    it('should count runs by status', () => {
      const runs = [
        { status: 'completed' },
        { status: 'completed' },
        { status: 'failed' },
        { status: 'running' },
      ] as const;
      const result = aggregateRunStatusCounts(runs);
      expect(result.total).toBe(4);
      expect(result.completed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.running).toBe(1);
      expect(result.interrupted).toBe(0);
    });

    it('should handle empty array', () => {
      const result = aggregateRunStatusCounts([]);
      expect(result.total).toBe(0);
      expect(result.completed).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.running).toBe(0);
      expect(result.interrupted).toBe(0);
    });

    it('should handle all statuses', () => {
      const runs = [
        { status: 'completed' },
        { status: 'failed' },
        { status: 'running' },
        { status: 'interrupted' },
      ] as const;
      const result = aggregateRunStatusCounts(runs);
      expect(result.total).toBe(4);
      expect(result.completed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.running).toBe(1);
      expect(result.interrupted).toBe(1);
    });

    it('should handle unknown status strings', () => {
      const runs = [
        { status: 'completed' },
        { status: 'unknown_status' },
      ] as const;
      const result = aggregateRunStatusCounts(runs);
      expect(result.total).toBe(2);
      expect(result.completed).toBe(1);
    });
  });
});
