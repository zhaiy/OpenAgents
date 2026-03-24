import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunState } from '../types/index.js';

// Create mock run state with cost data for testing
const createMockRunStateWithCosts = (overrides: Partial<RunState> = {}): RunState => ({
  runId: 'run-cost-test',
  workflowId: 'wf-cost',
  status: 'completed',
  input: 'test',
  startedAt: 1000,
  completedAt: 5000,
  steps: {
    'step1': {
      status: 'completed',
      startedAt: 1000,
      completedAt: 2000,
      durationMs: 1000,
      tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
    },
    'step2': {
      status: 'completed',
      startedAt: 2000,
      completedAt: 4000,
      durationMs: 2000,
      tokenUsage: { promptTokens: 500, completionTokens: 1000, totalTokens: 1500 },
    },
    'step3': {
      status: 'completed',
      startedAt: 4000,
      completedAt: 5000,
      durationMs: 1000,
      tokenUsage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
    },
  },
  ...overrides,
});

describe('Cost Observation (M5)', () => {
  describe('Step cost data structure', () => {
    it('should have tokenUsage with all required fields', () => {
      const run = createMockRunStateWithCosts();
      const step1 = run.steps['step1'];

      expect(step1.tokenUsage).toBeDefined();
      expect(step1.tokenUsage?.totalTokens).toBe(300);
      expect(step1.tokenUsage?.promptTokens).toBe(100);
      expect(step1.tokenUsage?.completionTokens).toBe(200);
    });

    it('should have durationMs for each step', () => {
      const run = createMockRunStateWithCosts();

      expect(run.steps['step1'].durationMs).toBe(1000);
      expect(run.steps['step2'].durationMs).toBe(2000);
      expect(run.steps['step3'].durationMs).toBe(1000);
    });
  });

  describe('Run-level cost aggregation', () => {
    it('should calculate total tokens from steps', () => {
      const run = createMockRunStateWithCosts();
      const stepValues = Object.values(run.steps);

      const totalTokens = stepValues.reduce((sum, step) => {
        return sum + (step.tokenUsage?.totalTokens ?? 0);
      }, 0);

      expect(totalTokens).toBe(1950); // 300 + 1500 + 150
    });

    it('should calculate total duration from steps', () => {
      const run = createMockRunStateWithCosts();
      const stepValues = Object.values(run.steps);

      const totalDurationMs = stepValues.reduce((sum, step) => {
        return sum + (step.durationMs ?? 0);
      }, 0);

      expect(totalDurationMs).toBe(4000); // 1000 + 2000 + 1000
    });

    it('should identify top tokens steps', () => {
      const run = createMockRunStateWithCosts();
      const stepEntries = Object.entries(run.steps);

      const sortedByTokens = stepEntries
        .map(([stepId, step]) => ({
          stepId,
          tokens: step.tokenUsage?.totalTokens ?? 0,
        }))
        .sort((a, b) => b.tokens - a.tokens);

      expect(sortedByTokens[0].stepId).toBe('step2'); // 1500 tokens
      expect(sortedByTokens[1].stepId).toBe('step1'); // 300 tokens
      expect(sortedByTokens[2].stepId).toBe('step3'); // 150 tokens
    });

    it('should identify top duration steps', () => {
      const run = createMockRunStateWithCosts();
      const stepEntries = Object.entries(run.steps);

      const sortedByDuration = stepEntries
        .map(([stepId, step]) => ({
          stepId,
          durationMs: step.durationMs ?? 0,
        }))
        .sort((a, b) => b.durationMs - a.durationMs);

      expect(sortedByDuration[0].stepId).toBe('step2'); // 2000ms
    });

    it('should calculate percentage of total tokens', () => {
      const run = createMockRunStateWithCosts();
      const totalTokens = Object.values(run.steps)
        .reduce((sum, step) => sum + (step.tokenUsage?.totalTokens ?? 0), 0);

      const step2Tokens = run.steps['step2'].tokenUsage?.totalTokens ?? 0;
      const percent = Math.round((step2Tokens / totalTokens) * 10000) / 100;

      expect(percent).toBeCloseTo(76.92, 1); // 1500/1950 ≈ 76.92%
    });

    it('should calculate percentage of total duration', () => {
      const run = createMockRunStateWithCosts();
      const totalDuration = Object.values(run.steps)
        .reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

      const step2Duration = run.steps['step2'].durationMs ?? 0;
      const percent = Math.round((step2Duration / totalDuration) * 10000) / 100;

      expect(percent).toBe(50); // 2000/4000 = 50%
    });

    it('should calculate average tokens per step', () => {
      const run = createMockRunStateWithCosts();
      const steps = Object.values(run.steps);
      const completedSteps = steps.filter(s => s.tokenUsage !== undefined).length;
      const totalTokens = steps.reduce((sum, step) => sum + (step.tokenUsage?.totalTokens ?? 0), 0);

      const avgTokens = Math.round(totalTokens / completedSteps);

      expect(avgTokens).toBe(650); // 1950/3 ≈ 650
    });

    it('should calculate average duration per step', () => {
      const run = createMockRunStateWithCosts();
      const steps = Object.values(run.steps);
      const completedSteps = steps.filter(s => s.durationMs !== undefined).length;
      const totalDuration = steps.reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

      const avgDuration = Math.round(totalDuration / completedSteps);

      expect(avgDuration).toBe(1333); // 4000/3 ≈ 1333.33
    });
  });

  describe('High-cost node identification', () => {
    it('should return top 5 steps by tokens (limit)', () => {
      const run = createMockRunStateWithCosts();
      const stepEntries = Object.entries(run.steps);

      const sortedByTokens = stepEntries
        .map(([stepId, step]) => ({
          stepId,
          tokens: step.tokenUsage?.totalTokens ?? 0,
        }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 5);

      expect(sortedByTokens.length).toBeLessThanOrEqual(5);
    });

    it('should return top 5 steps by duration (limit)', () => {
      const run = createMockRunStateWithCosts();
      const stepEntries = Object.entries(run.steps);

      const sortedByDuration = stepEntries
        .map(([stepId, step]) => ({
          stepId,
          durationMs: step.durationMs ?? 0,
        }))
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, 5);

      expect(sortedByDuration.length).toBeLessThanOrEqual(5);
    });

    it('should handle runs with no cost data', () => {
      const runNoCost = createMockRunStateWithCosts({
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
        },
      });

      const hasCostData = Object.values(runNoCost.steps).some(
        step => step.tokenUsage !== undefined || step.durationMs !== undefined
      );

      expect(hasCostData).toBe(false);
    });

    it('should handle mixed cost data (some steps have tokens, some have duration)', () => {
      const run = createMockRunStateWithCosts({
        steps: {
          'step1': {
            status: 'completed',
            durationMs: 1000,
            tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
          },
          'step2': {
            status: 'completed',
            durationMs: 2000,
            // No tokenUsage
          },
          'step3': {
            status: 'completed',
            // No durationMs
            tokenUsage: { promptTokens: 50, completionTokens: 100, totalTokens: 150 },
          },
        },
      });

      const totalDuration = Object.values(run.steps)
        .reduce((sum, step) => sum + (step.durationMs ?? 0), 0);

      const totalTokens = Object.values(run.steps)
        .reduce((sum, step) => sum + (step.tokenUsage?.totalTokens ?? 0), 0);

      expect(totalDuration).toBe(3000); // step1 + step2
      expect(totalTokens).toBe(450); // step1 + step3
    });
  });

  describe('Run comparison cost diff', () => {
    it('should compute duration diff between two runs', () => {
      const runA = { startedAt: 1000, completedAt: 3000 } as RunState;
      const runB = { startedAt: 1000, completedAt: 5000 } as RunState;

      const durationA = runA.completedAt! - runA.startedAt;
      const durationB = runB.completedAt! - runB.startedAt;
      const delta = durationB - durationA;
      const percentChange = (delta / durationA) * 100;

      expect(durationA).toBe(2000);
      expect(durationB).toBe(4000);
      expect(delta).toBe(2000);
      expect(percentChange).toBe(100); // 100% slower
    });

    it('should compute token usage diff between two runs', () => {
      const runA = {
        steps: {
          'step1': { tokenUsage: { totalTokens: 500 } },
        },
      } as unknown as RunState;

      const runB = {
        steps: {
          'step1': { tokenUsage: { totalTokens: 750 } },
        },
      } as unknown as RunState;

      const tokensA = Object.values(runA.steps).reduce(
        (sum, step) => sum + (step.tokenUsage?.totalTokens ?? 0), 0
      );
      const tokensB = Object.values(runB.steps).reduce(
        (sum, step) => sum + (step.tokenUsage?.totalTokens ?? 0), 0
      );

      const delta = tokensB - tokensA;
      const percentChange = (delta / tokensA) * 100;

      expect(delta).toBe(250);
      expect(percentChange).toBe(50); // 50% more tokens
    });
  });
});
