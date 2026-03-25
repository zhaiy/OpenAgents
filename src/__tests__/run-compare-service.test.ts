/**
 * Tests for RunCompareService (N7 Enhancement)
 *
 * Covers:
 * - Enhanced input diff with types
 * - Node-level duration and error comparison
 * - Output diff with previews
 * - Comparison summary with recommendations
 * - Session TTL management
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunCompareService } from '../app/services/run-compare-service.js';
import type { RunState } from '../types/index.js';

describe('RunCompareService (N7)', () => {
  let service: RunCompareService;
  let mockStateManager: {
    findRunById: ReturnType<typeof vi.fn>;
  };

  const createMockRunState = (overrides: Partial<RunState> = {}): RunState => ({
    runId: 'run-123',
    workflowId: 'wf-456',
    workflowName: 'Test Workflow',
    status: 'completed',
    input: 'test input',
    inputData: { query: 'test' },
    startedAt: 1000,
    completedAt: 5000,
    steps: {},
    ...overrides,
  });

  beforeEach(() => {
    mockStateManager = {
      findRunById: vi.fn(),
    };
    // Use short TTL for testing
    service = new RunCompareService(mockStateManager as never, 1000);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Basic Comparison Tests
  // ===========================================================================

  describe('compare', () => {
    it('should compare two runs and return enhanced differences', () => {
      const runA = createMockRunState({
        runId: 'run-a',
        workflowId: 'wf-1',
        workflowName: 'Workflow A',
        status: 'completed',
        startedAt: 1000,
        completedAt: 5000,
        inputData: { query: 'test a', count: 10 },
        steps: {
          'step-1': {
            status: 'completed',
            startedAt: 1000,
            completedAt: 2000,
            tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
          },
          'step-2': {
            status: 'completed',
            startedAt: 2000,
            completedAt: 3000,
            tokenUsage: { promptTokens: 150, completionTokens: 250, totalTokens: 400 },
          },
        },
      });

      const runB = createMockRunState({
        runId: 'run-b',
        workflowId: 'wf-1',
        workflowName: 'Workflow A',
        status: 'failed',
        startedAt: 1000,
        completedAt: 4000,
        inputData: { query: 'test b', count: 10, extra: 'new' },
        steps: {
          'step-1': {
            status: 'completed',
            startedAt: 1000,
            completedAt: 2500,
            tokenUsage: { promptTokens: 120, completionTokens: 220, totalTokens: 340 },
          },
          'step-2': {
            status: 'failed',
            startedAt: 2500,
            completedAt: 3500,
            error: 'Step failed due to timeout',
          },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      // Basic info
      expect(result.runAId).toBe('run-a');
      expect(result.runBId).toBe('run-b');
      expect(result.workflowInfo?.isSameWorkflow).toBe(true);

      // Status diff
      expect(result.statusDiff).toEqual({ runA: 'completed', runB: 'failed' });

      // Input diff with types
      expect(result.inputDiff).toBeDefined();
      expect(result.inputDiff?.length).toBeGreaterThanOrEqual(2);
      
      const queryDiff = result.inputDiff?.find((d) => d.field === 'query');
      expect(queryDiff?.diffType).toBe('changed');
      expect(queryDiff?.valueA).toBe('test a');
      expect(queryDiff?.valueB).toBe('test b');

      const extraDiff = result.inputDiff?.find((d) => d.field === 'extra');
      expect(extraDiff?.diffType).toBe('added');
      expect(extraDiff?.valueB).toBe('new');

      // Input diff summary
      expect(result.inputDiffSummary?.added).toBeGreaterThanOrEqual(1);
      expect(result.inputDiffSummary?.changed).toBeGreaterThanOrEqual(1);

      // Node status diff with critical flag
      expect(result.nodeStatusDiff).toBeDefined();
      expect(result.nodeStatusDiff?.length).toBeGreaterThanOrEqual(1);
      const step2Diff = result.nodeStatusDiff?.find((d) => d.nodeId === 'step-2');
      expect(step2Diff?.isCritical).toBe(true);
      expect(step2Diff?.errorB).toBe('Step failed due to timeout');

      // Duration diff with delta and percent
      expect(result.durationDiff).toBeDefined();
      expect(result.durationDiff?.delta).toBe(-1000);
      expect(result.durationDiff?.percentChange).toBe(-25);

      // Token usage diff with delta
      expect(result.tokenUsageDiff).toBeDefined();
      expect(result.tokenUsageDiff?.delta).toBe(360);

      // Summary
      expect(result.summary).toBeDefined();
      expect(result.summary.similarityScore).toBeLessThan(100);
      expect(result.summary.keyDifferences.length).toBeGreaterThan(0);
      expect(result.summary.warnings).toContain('Run B failed while Run A completed successfully');
    });

    it('should detect type changes in input diff', () => {
      const runA = createMockRunState({
        inputData: { count: 10, name: 'test' },
      });

      const runB = createMockRunState({
        inputData: { count: 'ten', name: 'test' },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      const countDiff = result.inputDiff?.find((d) => d.field === 'count');
      expect(countDiff?.diffType).toBe('type_changed');
      expect(countDiff?.typeA).toBe('number');
      expect(countDiff?.typeB).toBe('string');
    });

    it('should compute node duration differences', () => {
      const runA = createMockRunState({
        steps: {
          'step-1': {
            status: 'completed',
            startedAt: 1000,
            completedAt: 2000,
          },
        },
      });

      const runB = createMockRunState({
        steps: {
          'step-1': {
            status: 'completed',
            startedAt: 1000,
            completedAt: 3500,
          },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.nodeStatusDiff).toBeDefined();
      expect(result.nodeStatusDiff?.[0].durationDiff).toEqual({
        runA: 1000,
        runB: 2500,
        delta: 1500,
      });
    });

    it('should compute output differences', () => {
      const runA = createMockRunState({
        steps: {
          'step-1': {
            status: 'completed',
            output: 'Result A',
          },
          'step-2': {
            status: 'completed',
            outputFile: '/path/to/output.json',
          },
        },
      });

      const runB = createMockRunState({
        steps: {
          'step-1': {
            status: 'completed',
            output: 'Result B',
          },
          'step-2': {
            status: 'completed',
            // No output
          },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.outputDiff).toBeDefined();
      expect(result.outputDiff?.length).toBe(2);

      const step1Diff = result.outputDiff?.find((d) => d.nodeId === 'step-1');
      expect(step1Diff?.isIdentical).toBe(false);
      expect(step1Diff?.previewA).toBe('Result A');
      expect(step1Diff?.previewB).toBe('Result B');

      const step2Diff = result.outputDiff?.find((d) => d.nodeId === 'step-2');
      expect(step2Diff?.hasOutputA).toBe(true);
      expect(step2Diff?.hasOutputB).toBe(false);
    });

    it('should generate appropriate recommendations', () => {
      const runA = createMockRunState({
        status: 'failed',
        steps: {
          'step-1': { status: 'failed', error: 'Error' },
        },
      });

      const runB = createMockRunState({
        status: 'completed',
        steps: {
          'step-1': { status: 'completed' },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.summary.recommendations).toContain(
        'Run B appears to have fixed the issue from Run A',
      );
    });

    it('should warn when both runs failed', () => {
      const runA = createMockRunState({ status: 'failed' });
      const runB = createMockRunState({ status: 'failed' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.summary.warnings).toContain(
        'Both runs failed - consider reviewing the workflow configuration',
      );
    });

    it('should detect different workflows', () => {
      const runA = createMockRunState({
        workflowId: 'wf-1',
        workflowName: 'Workflow A',
      });

      const runB = createMockRunState({
        workflowId: 'wf-2',
        workflowName: 'Workflow B',
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.workflowInfo?.isSameWorkflow).toBe(false);
    });

    it('should return high similarity score for identical runs', () => {
      const runA = createMockRunState({
        status: 'completed',
        inputData: { query: 'same' },
        steps: {
          'step-1': { status: 'completed', startedAt: 1000, completedAt: 2000 },
        },
      });

      const runB = createMockRunState({
        status: 'completed',
        inputData: { query: 'same' },
        steps: {
          'step-1': { status: 'completed', startedAt: 1000, completedAt: 2000 },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.summary.similarityScore).toBe(100);
      expect(result.summary.keyDifferences.length).toBe(0);
    });

    it('should include workflowConfigDiff when workflow snapshots differ', () => {
      const runA = createMockRunState({
        workflowSnapshot: {
          workflowId: 'wf-1',
          versionHash: 'aaa111',
          capturedAt: 1000,
          steps: {
            'step-1': {
              id: 'step-1',
              agent: { id: 'agent-a', name: 'Agent A', model: 'gpt-4', runtimeType: 'llm-direct' },
              systemPrompt: 'Prompt A',
              task: 'Task A',
              dependsOn: [],
              gate: 'auto',
            },
          },
        },
      });

      const runB = createMockRunState({
        workflowSnapshot: {
          workflowId: 'wf-1',
          versionHash: 'bbb222',
          capturedAt: 1001,
          steps: {
            'step-1': {
              id: 'step-1',
              agent: { id: 'agent-a', name: 'Agent A', model: 'gpt-4.1', runtimeType: 'llm-direct' },
              systemPrompt: 'Prompt B',
              task: 'Task A',
              dependsOn: [],
              gate: 'auto',
            },
          },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.workflowConfigDiff).toBeDefined();
      expect(result.workflowConfigDiff?.isSameConfig).toBe(false);
      expect(result.summary.versionDiffSummary?.hasConfigDiff).toBe(true);
      expect(result.summary.versionDiffSummary?.configChanges).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Session Management Tests
  // ===========================================================================

  describe('session management', () => {
    it('should create session with TTL', () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const session = service.createSession('run-a', 'run-b');

      expect(session.sessionId).toBeDefined();
      expect(session.ttl).toBe(1000);
      expect(session.expiresAt).toBeGreaterThan(session.createdAt);
      expect(session.comparison).toBeDefined();
    });

    it('should get valid session', () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const created = service.createSession('run-a', 'run-b');
      const retrieved = service.getSession(created.sessionId);

      expect(retrieved).toEqual(created);
    });

    it('should return null for expired session', async () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const created = service.createSession('run-a', 'run-b');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const retrieved = service.getSession(created.sessionId);
      expect(retrieved).toBeNull();
    });

    it('should delete session', () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const created = service.createSession('run-a', 'run-b');
      const deleted = service.deleteSession(created.sessionId);

      expect(deleted).toBe(true);
      expect(service.getSession(created.sessionId)).toBeNull();
    });

    it('should cleanup expired sessions on create', async () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      // Create first session
      const session1 = service.createSession('run-a', 'run-b');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Create second session (should cleanup expired)
      const session2 = service.createSession('run-a', 'run-b');

      expect(service.getSession(session1.sessionId)).toBeNull();
      expect(service.getSession(session2.sessionId)).toBeDefined();
    });

    it('should count active sessions', () => {
      const runA = createMockRunState({ runId: 'run-a' });
      const runB = createMockRunState({ runId: 'run-b' });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      expect(service.getActiveSessionCount()).toBe(0);

      service.createSession('run-a', 'run-b');
      expect(service.getActiveSessionCount()).toBe(1);

      service.createSession('run-a', 'run-b');
      expect(service.getActiveSessionCount()).toBe(2);
    });
  });

  // ===========================================================================
  // Edge Cases
  // ===========================================================================

  describe('edge cases', () => {
    it('should handle runs with no input data', () => {
      const runA = createMockRunState({ inputData: undefined });
      const runB = createMockRunState({ inputData: undefined });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.inputDiff).toBeUndefined();
      expect(result.inputDiffSummary).toEqual({
        added: 0,
        removed: 0,
        changed: 0,
        unchanged: 0,
      });
    });

    it('should handle runs with no steps', () => {
      const runA = createMockRunState({ steps: {} });
      const runB = createMockRunState({ steps: {} });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.nodeStatusDiff).toBeUndefined();
      expect(result.nodeDiffSummary).toEqual({
        totalNodes: 0,
        identical: 0,
        different: 0,
        onlyInA: 0,
        onlyInB: 0,
      });
      expect(result.tokenUsageDiff).toBeUndefined();
    });

    it('should handle runs with no token usage', () => {
      const runA = createMockRunState({
        steps: {
          'step-1': { status: 'completed' },
        },
      });

      const runB = createMockRunState({
        steps: {
          'step-1': { status: 'completed' },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      expect(result.tokenUsageDiff).toBeUndefined();
    });

    it('should truncate long output previews', () => {
      const longOutput = 'x'.repeat(500);
      const runA = createMockRunState({
        steps: {
          'step-1': { status: 'completed', output: longOutput },
        },
      });

      const runB = createMockRunState({
        steps: {
          'step-1': { status: 'completed', output: 'short' },
        },
      });

      mockStateManager.findRunById.mockImplementation((runId: string) => {
        if (runId === 'run-a') return runA;
        if (runId === 'run-b') return runB;
        throw new Error(`Run not found: ${runId}`);
      });

      const result = service.compare('run-a', 'run-b');

      const outputDiff = result.outputDiff?.[0];
      expect(outputDiff?.previewA?.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(outputDiff?.previewA?.endsWith('...')).toBe(true);
    });
  });
});