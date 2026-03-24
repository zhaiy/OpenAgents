import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagnosticsService } from '../app/services/diagnostics-service.js';
import type { RunState } from '../types/index.js';

describe('Quality Observation (M6)', () => {
  let service: DiagnosticsService;
  let mockStateManager: {
    listRuns: ReturnType<typeof vi.fn>;
    findRunById: ReturnType<typeof vi.fn>;
  };
  let mockConfigLoader: {
    loadWorkflow: ReturnType<typeof vi.fn>;
  };

  const createMockRunState = (overrides: Partial<RunState> = {}): RunState => ({
    runId: 'run-123',
    workflowId: 'wf-456',
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
      listRuns: vi.fn(),
      findRunById: vi.fn(),
    };
    mockConfigLoader = {
      loadWorkflow: vi.fn(),
    };
    service = new DiagnosticsService(mockStateManager as never, mockConfigLoader as never);
  });

  describe('getWorkflowQualitySummary', () => {
    it('should return null for non-existent workflow', () => {
      mockStateManager.listRuns.mockReturnValue([]);

      const result = service.getWorkflowQualitySummary('nonexistent');

      expect(result).toBeNull();
    });

    it('should calculate correct success and failure counts', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed' }),
        createMockRunState({ runId: 'run-2', status: 'completed' }),
        createMockRunState({ runId: 'run-3', status: 'failed' }),
        createMockRunState({ runId: 'run-4', status: 'running' }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.totalRuns).toBe(4);
      expect(result!.successCount).toBe(2);
      expect(result!.failureCount).toBe(1);
      expect(result!.activeCount).toBe(1);
    });

    it('should calculate correct success rate', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed' }),
        createMockRunState({ runId: 'run-2', status: 'failed' }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.successRate).toBe(50);
      expect(result!.failureRate).toBe(50);
    });

    it('should calculate average duration', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed', startedAt: 1000, completedAt: 2000 }),
        createMockRunState({ runId: 'run-2', status: 'completed', startedAt: 1000, completedAt: 3000 }),
        createMockRunState({ runId: 'run-3', status: 'failed', startedAt: 1000, completedAt: 1500 }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      // Average of completed runs: (1000 + 2000) / 2 = 1500
      expect(result!.avgDurationMs).toBe(1500);
    });

    it('should not include failed runs in duration average', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'failed', startedAt: 1000, completedAt: 5000 }),
        createMockRunState({ runId: 'run-2', status: 'completed', startedAt: 1000, completedAt: 3000 }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      // Only completed run counts: 3000 - 1000 = 2000
      expect(result!.avgDurationMs).toBe(2000);
    });

    it('should compute gate wait statistics', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'running',
          steps: {
            'gate-step': { status: 'gate_waiting', startedAt: 3000 },
          },
        }),
        createMockRunState({
          runId: 'run-2',
          status: 'completed',
          steps: {},
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.gateWaitStats.totalGateWaits).toBe(1);
      expect(result!.gateWaitStats.runsWithGateWait).toBe(1);
      expect(result!.gateWaitStats.lastGateWaitAt).toBe(3000);
    });

    it('should compute failure type distribution', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'failed',
          steps: {
            'step1': { status: 'failed', error: 'API key is invalid' },
          },
        }),
        createMockRunState({
          runId: 'run-2',
          status: 'failed',
          steps: {
            'step1': { status: 'failed', error: 'API key is invalid' },
          },
        }),
        createMockRunState({
          runId: 'run-3',
          status: 'failed',
          steps: {
            'step1': { status: 'failed', error: 'timeout error' },
          },
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.failureTypes.length).toBeGreaterThan(0);
      // AuthenticationError should be most common
      expect(result!.failureTypes[0].errorType).toBe('AuthenticationError');
      expect(result!.failureTypes[0].count).toBe(2);
    });

    it('should include workflow name when available', () => {
      const runs = [createMockRunState({ runId: 'run-1', status: 'completed' })];
      mockStateManager.listRuns.mockReturnValue(runs);
      mockConfigLoader.loadWorkflow.mockReturnValue({
        workflow: { id: 'wf-456', name: 'Test Workflow', description: '' },
        steps: [],
        output: { directory: './output' },
      });

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.workflowName).toBe('Test Workflow');
    });

    it('should limit recent runs', () => {
      const runs = Array.from({ length: 20 }, (_, i) =>
        createMockRunState({ runId: `run-${i}`, status: 'completed', startedAt: 1000 + i * 1000 })
      );
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456', 5);

      expect(result).not.toBeNull();
      expect(result!.recentRuns.length).toBe(5);
    });

    it('should sort recent runs by startedAt descending', () => {
      const runs = [
        createMockRunState({ runId: 'run-old', status: 'completed', startedAt: 1000 }),
        createMockRunState({ runId: 'run-new', status: 'completed', startedAt: 5000 }),
        createMockRunState({ runId: 'run-mid', status: 'completed', startedAt: 3000 }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456', 3);

      expect(result).not.toBeNull();
      expect(result!.recentRuns[0].runId).toBe('run-new');
      expect(result!.recentRuns[1].runId).toBe('run-mid');
      expect(result!.recentRuns[2].runId).toBe('run-old');
    });

    it('should handle all completed runs', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed' }),
        createMockRunState({ runId: 'run-2', status: 'completed' }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.successRate).toBe(100);
      expect(result!.failureRate).toBe(0);
      expect(result!.failureCount).toBe(0);
    });

    it('should handle all failed runs', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'failed', steps: { 'step1': { status: 'failed', error: 'error' } } }),
        createMockRunState({ runId: 'run-2', status: 'failed', steps: { 'step1': { status: 'failed', error: 'error' } } }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.successRate).toBe(0);
      expect(result!.failureRate).toBe(100);
      expect(result!.successCount).toBe(0);
    });
  });

  describe('getAllWorkflowQualitySummaries', () => {
    it('should return summaries for all workflows', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', workflowId: 'wf-1', status: 'completed' }),
        createMockRunState({ runId: 'run-2', workflowId: 'wf-2', status: 'completed' }),
        createMockRunState({ runId: 'run-3', workflowId: 'wf-1', status: 'failed', steps: { 'step1': { status: 'failed', error: 'error' } } }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const results = service.getAllWorkflowQualitySummaries();

      expect(results.length).toBe(2);
      const wf1 = results.find(r => r.workflowId === 'wf-1');
      const wf2 = results.find(r => r.workflowId === 'wf-2');
      expect(wf1).toBeDefined();
      expect(wf2).toBeDefined();
      expect(wf1!.totalRuns).toBe(2);
      expect(wf2!.totalRuns).toBe(1);
    });

    it('should return empty array when no runs exist', () => {
      mockStateManager.listRuns.mockReturnValue([]);

      const results = service.getAllWorkflowQualitySummaries();

      expect(results).toEqual([]);
    });
  });

  describe('Error type classification', () => {
    it('should classify authentication errors', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'failed',
          steps: { 'step1': { status: 'failed', error: 'API key is invalid' } },
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.failureTypes[0].errorType).toBe('AuthenticationError');
    });

    it('should classify rate limit errors', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'failed',
          steps: { 'step1': { status: 'failed', error: 'Rate limit exceeded (429)' } },
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.failureTypes[0].errorType).toBe('RateLimitError');
    });

    it('should classify timeout errors', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'failed',
          steps: { 'step1': { status: 'failed', error: 'Request timed out' } },
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.failureTypes[0].errorType).toBe('TimeoutError');
    });

    it('should classify unknown errors', () => {
      const runs = [
        createMockRunState({
          runId: 'run-1',
          status: 'failed',
          steps: { 'step1': { status: 'failed', error: 'Some unknown error' } },
        }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWorkflowQualitySummary('wf-456');

      expect(result).not.toBeNull();
      expect(result!.failureTypes[0].errorType).toBe('UnknownError');
    });
  });
});
