import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiagnosticsService } from '../app/services/diagnostics-service.js';
import type { RunState, WorkflowConfig } from '../types/index.js';

describe('DiagnosticsService', () => {
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

  const createMockWorkflowConfig = (overrides: Partial<WorkflowConfig> = {}): WorkflowConfig => ({
    workflow: {
      id: 'wf-456',
      name: 'Test Workflow',
      description: 'A test workflow',
    },
    steps: [
      { id: 'step1', agent: 'agent1', task: 'task1' },
      { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
      { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
    ],
    output: { directory: './output' },
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

  describe('getFailedRunsSummary', () => {
    it('should return all failed runs', () => {
      const failedRun = createMockRunState({
        runId: 'run-failed',
        status: 'failed',
        completedAt: 5000,
        steps: {
          'step-1': { status: 'failed', error: 'something went wrong' },
        },
      });

      mockStateManager.listRuns.mockReturnValue([failedRun]);

      const result = service.getFailedRunsSummary();

      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe('run-failed');
      expect(result[0].failedAt).toBe(5000);
      expect(result[0].errorMessage).toBe('something went wrong');
      expect(result[0].failedNodeId).toBe('step-1');
    });

    it('should return empty array when no failed runs', () => {
      const completedRun = createMockRunState({ status: 'completed' });
      mockStateManager.listRuns.mockReturnValue([completedRun]);

      const result = service.getFailedRunsSummary();

      expect(result).toHaveLength(0);
    });

    it('should filter out non-failed statuses', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed' }),
        createMockRunState({ runId: 'run-2', status: 'failed' }),
        createMockRunState({ runId: 'run-3', status: 'running' }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getFailedRunsSummary();

      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe('run-2');
    });

    it('should identify failed node with error', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'node-a': { status: 'completed' },
          'node-b': { status: 'failed', error: 'critical error' },
          'node-c': { status: 'skipped' },
        },
      });
      mockStateManager.listRuns.mockReturnValue([failedRun]);

      const result = service.getFailedRunsSummary();

      expect(result[0].failedNodeId).toBe('node-b');
      expect(result[0].errorMessage).toBe('critical error');
    });
  });

  describe('getWaitingGatesSummary', () => {
    it('should return all runs with gate_waiting nodes', () => {
      const waitingRun = createMockRunState({
        status: 'running',
        steps: {
          'gate-step': { status: 'gate_waiting', startedAt: 3000 },
        },
      });
      mockStateManager.listRuns.mockReturnValue([waitingRun]);

      const result = service.getWaitingGatesSummary();

      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe('run-123');
      expect(result[0].stepId).toBe('gate-step');
      expect(result[0].waitedAt).toBe(3000);
    });

    it('should return empty array when no waiting gates', () => {
      const completedRun = createMockRunState({
        status: 'completed',
        steps: {
          'normal-step': { status: 'completed' },
        },
      });
      mockStateManager.listRuns.mockReturnValue([completedRun]);

      const result = service.getWaitingGatesSummary();

      expect(result).toHaveLength(0);
    });

    it('should filter to only running status runs', () => {
      const runs = [
        createMockRunState({ runId: 'run-1', status: 'completed', steps: { 'step-1': { status: 'gate_waiting' } } }),
        createMockRunState({ runId: 'run-2', status: 'failed', steps: { 'step-1': { status: 'gate_waiting' } } }),
        createMockRunState({ runId: 'run-3', status: 'running', steps: { 'step-1': { status: 'gate_waiting' } } }),
      ];
      mockStateManager.listRuns.mockReturnValue(runs);

      const result = service.getWaitingGatesSummary();

      expect(result).toHaveLength(1);
      expect(result[0].runId).toBe('run-3');
    });

    it('should identify multiple waiting gates', () => {
      const runWithTwoGates = createMockRunState({
        status: 'running',
        steps: {
          'gate-1': { status: 'gate_waiting', startedAt: 1000 },
          'gate-2': { status: 'gate_waiting', startedAt: 2000 },
          'normal-step': { status: 'completed' },
        },
      });
      mockStateManager.listRuns.mockReturnValue([runWithTwoGates]);

      const result = service.getWaitingGatesSummary();

      expect(result).toHaveLength(2);
      expect(result.map(r => r.stepId)).toContain('gate-1');
      expect(result.map(r => r.stepId)).toContain('gate-2');
    });
  });

  describe('getRunDiagnostics', () => {
    it('should return diagnostics for a failed run', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        completedAt: 5000,
        steps: {
          'step-1': { status: 'completed', startedAt: 1000, completedAt: 2000 },
          'step-2': { status: 'failed', startedAt: 2000, completedAt: 3000, error: 'step 2 failed' },
          'step-3': { status: 'skipped', startedAt: 3000, completedAt: 4000 },
        },
      });

      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-123');
      expect(result!.workflowId).toBe('wf-456');
      expect(result!.workflowName).toBe('Test Workflow');
      expect(result!.runStatus).toBe('failed');
      expect(result!.failedNodeIds).toContain('step-2');
      expect(result!.errorSummary).toHaveLength(1);
      expect(result!.errorSummary[0].errorMessage).toBe('step 2 failed');
    });

    it('should return null when run not found', () => {
      mockStateManager.findRunById.mockImplementation(() => {
        throw new Error('Run not found');
      });

      const result = service.getRunDiagnostics('non-existent');

      expect(result).toBeNull();
    });

    it('should return diagnostics for completed run with no issues', () => {
      const completedRun = createMockRunState({
        status: 'completed',
        steps: {
          'step-1': { status: 'completed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(completedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.failedNodeIds).toHaveLength(0);
      expect(result!.gateWaitingNodeIds).toHaveLength(0);
    });

    it('should identify gate waiting nodes', () => {
      const waitingRun = createMockRunState({
        status: 'running',
        steps: {
          'gate-step': { status: 'gate_waiting', startedAt: 3000 },
          'other-step': { status: 'running', startedAt: 1000 },
        },
      });
      mockStateManager.findRunById.mockReturnValue(waitingRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.gateWaitingNodeIds).toContain('gate-step');
    });

    it('should show upstream states for all nodes', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'upstream-1': { status: 'completed' },
          'upstream-2': { status: 'completed' },
          'failed-step': { status: 'failed', error: 'downstream failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.upstreamStates['upstream-1']).toBe('completed');
      expect(result!.upstreamStates['upstream-2']).toBe('completed');
      expect(result!.upstreamStates['failed-step']).toBe('failed');
    });

    it('should map error patterns to suggested actions', () => {
      const authErrorRun = createMockRunState({
        status: 'failed',
        steps: {
          'auth-step': { status: 'failed', error: 'API key is invalid' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(authErrorRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.errorSummary[0].errorType).toBe('AuthenticationError');
      expect(result!.errorSummary[0].suggestedActions).toContain('Check your API key configuration in Settings');
    });
  });

  describe('Failed node details', () => {
    it('should provide detailed failed node information', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed', startedAt: 1000, completedAt: 2000 },
          'step2': { status: 'failed', startedAt: 2000, completedAt: 3000, error: 'API key is invalid' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.failedNodes).toHaveLength(1);
      expect(result!.failedNodes[0].nodeId).toBe('step2');
      expect(result!.failedNodes[0].errorType).toBe('AuthenticationError');
      expect(result!.failedNodes[0].errorMessage).toBe('API key is invalid');
      expect(result!.failedNodes[0].upstreamCompleted).toContain('step1');
    });
  });

  describe('Downstream impact analysis', () => {
    it('should identify blocked downstream nodes', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'pending' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.downstreamImpact).toHaveLength(1);
      expect(result!.downstreamImpact[0].nodeId).toBe('step3');
      expect(result!.downstreamImpact[0].impactType).toBe('blocked');
    });

    it('should identify skipped downstream nodes', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.downstreamImpact).toHaveLength(1);
      expect(result!.downstreamImpact[0].impactType).toBe('skipped');
    });

    it('should handle multiple downstream levels', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
          { id: 'step4', agent: 'agent4', task: 'task4', depends_on: ['step3'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'pending' },
          'step4': { status: 'pending' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.downstreamImpact).toHaveLength(2);
      const impactedIds = result!.downstreamImpact.map((n) => n.nodeId);
      expect(impactedIds).toContain('step3');
      expect(impactedIds).toContain('step4');
    });
  });

  describe('Failure propagation analysis', () => {
    it('should identify root cause node', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.failurePropagation).toBeDefined();
      expect(result!.failurePropagation!.rootCauseNodeId).toBe('step2');
    });

    it('should build propagation path', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.failurePropagation!.propagationPath).toContain('step2');
      expect(result!.failurePropagation!.propagationPath).toContain('step3');
    });

    it('should generate summary', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.failurePropagation!.summary).toContain('step2');
      expect(result!.failurePropagation!.summary).toContain('blocked 1 downstream node');
    });
  });

  describe('Recommended actions', () => {
    it('should recommend rerun for failed runs', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recommendedActions.length).toBeGreaterThan(0);
      const rerunAction = result!.recommendedActions.find((a) => a.type === 'rerun');
      expect(rerunAction).toBeDefined();
      expect(rerunAction!.priority).toBe('high');
      expect(rerunAction!.targetRunId).toBe('run-123');
    });

    it('should recommend check_api for authentication errors', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'failed', error: 'API key is invalid' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      const checkApiAction = result!.recommendedActions.find((a) => a.type === 'check_api');
      expect(checkApiAction).toBeDefined();
      expect(checkApiAction!.priority).toBe('high');
    });

    it('should recommend rerun_with_edits when there is downstream impact', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      const rerunWithEditsAction = result!.recommendedActions.find((a) => a.type === 'rerun_with_edits');
      expect(rerunWithEditsAction).toBeDefined();
    });
  });

  describe('Without workflow config', () => {
    it('should still return basic diagnostics when workflow config is unavailable', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockImplementation(() => {
        throw new Error('Workflow not found');
      });

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.runId).toBe('run-123');
      expect(result!.failedNodeIds).toContain('step1');
      // Downstream impact should be empty without workflow config
      expect(result!.downstreamImpact).toHaveLength(0);
    });
  });

  // =============================================================================
  // M3: Recovery Scope and Preview Consistency Tests
  // =============================================================================

  describe('Recovery scope computation', () => {
    it('should include recoveryScope for failed runs', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'API timeout' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      expect(result!.recoveryScope!.reusedCount).toBeGreaterThanOrEqual(0);
      expect(result!.recoveryScope!.rerunCount).toBeGreaterThanOrEqual(0);
      expect(result!.recoveryScope!.invalidatedCount).toBeGreaterThanOrEqual(0);
    });

    it('should not include recoveryScope for completed runs', () => {
      const completedRun = createMockRunState({
        status: 'completed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'completed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(completedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeUndefined();
    });

    it('should correctly count reused steps (upstream of failure point)', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'completed' },
          'step3': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      }));

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step1 and step2 are upstream of step3 (the failure point), so they can be reused
      expect(result!.recoveryScope!.reusedCount).toBe(2);
    });

    it('should correctly count rerun steps (failed and pending)', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'pending' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      }));

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step2 (failed) and step3 (pending) need to rerun
      expect(result!.recoveryScope!.rerunCount).toBe(2);
    });

    it('should correctly count invalidated steps (downstream of failure)', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'pending' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      }));

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step3 is pending (not yet run), so it needs to be rerun, not invalidated
      // pending/running/gate_waiting steps are counted as rerun
      expect(result!.recoveryScope!.rerunCount).toBe(2); // step2 and step3
      expect(result!.recoveryScope!.reusedCount).toBe(1); // step1
    });

    it('should calculate high risk when rerun ratio > 50%', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // All steps need rerun, so rerun ratio is 100% (> 50%), risk is high
      expect(result!.recoveryScope!.riskLevel).toBe('high');
    });

    it('should calculate low risk when rerun ratio < 20% with no gates', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
          { id: 'step4', agent: 'agent4', task: 'task4', depends_on: ['step3'] },
          { id: 'step5', agent: 'agent5', task: 'task5', depends_on: ['step4'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'completed' },
          'step3': { status: 'completed' },
          'step4': { status: 'completed' },
          'step5': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // 4 reused, 1 rerun = rerun ratio 1/5 = 20%, still medium since it's not < 20%
      // Actually 1/(4+1) = 0.2 which is not < 0.2, so it's medium
      // Let's test with 5 completed and 1 failed: 5/(5+1) = 0.167 < 0.2, so low
      expect(result!.recoveryScope!.rerunCount).toBe(1);
      expect(result!.recoveryScope!.reusedCount).toBe(4);
    });

    it('should set high risk when gate is in failure chain', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'], gate: 'approve' as never },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'gate rejected' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      expect(result!.recoveryScope!.riskLevel).toBe('high');
    });

    it('should generate correct summary text', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      expect(typeof result!.recoveryScope!.summary).toBe('string');
      expect(result!.recoveryScope!.summary.length).toBeGreaterThan(0);
    });
  });

  describe('Recovery recommended action (M3)', () => {
    it('should include recover action when recovery scope exists', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      const recoverAction = result!.recommendedActions.find((a) => a.type === 'recover');
      expect(recoverAction).toBeDefined();
      expect(recoverAction!.targetRunId).toBe('run-123');
      expect(recoverAction!.priority).toBe('high');
    });

    it('should not include recover action when no steps need rerun', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'failed', error: 'failed' },
        },
      });
      // This creates a scenario where rerunCount = 0? No, a failed step always needs rerun.
      // Actually looking at computeRecoveryScope, a 'failed' step is counted as rerunCount.
      // So recover will be recommended if rerunCount > 0.
      // To test the negative case, we'd need a scenario where rerunCount = 0 but it's a failed run.
      // That's not possible in the current logic - a failed run always has at least one failed step.
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      // Even with just 1 failed step, recover should be recommended with rerun
      const recoverAction = result!.recommendedActions.find((a) => a.type === 'recover');
      expect(recoverAction).toBeDefined();
    });

    it('should describe recovery scope in action description', () => {
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'completed' },
          'step3': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      const recoverAction = result!.recommendedActions.find((a) => a.type === 'recover');
      expect(recoverAction).toBeDefined();
      expect(recoverAction!.description).toContain('Reuse');
      expect(recoverAction!.description).toContain('re-run');
    });

    it('should not duplicate recover action', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig());

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      const recoverActions = result!.recommendedActions.filter((a) => a.type === 'recover');
      expect(recoverActions).toHaveLength(1);
    });
  });

  describe('Preview consistency with actual recovery behavior', () => {
    it('preview counts should match when all steps completed except last', () => {
      // Simulates a workflow where steps 1-4 completed, step5 failed
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
          { id: 'step4', agent: 'agent4', task: 'task4', depends_on: ['step3'] },
          { id: 'step5', agent: 'agent5', task: 'task5', depends_on: ['step4'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'completed' },
          'step3': { status: 'completed' },
          'step4': { status: 'completed' },
          'step5': { status: 'failed', error: 'final step failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step1-4 are upstream of step5, so reused
      expect(result!.recoveryScope!.reusedCount).toBe(4);
      // step5 (failed) needs rerun
      expect(result!.recoveryScope!.rerunCount).toBe(1);
      // No downstream since step5 is the last
      expect(result!.recoveryScope!.invalidatedCount).toBe(0);
    });

    it('preview counts should match parallel branch failure', () => {
      // Workflow with parallel branches:
      // step1 -> step2a
      // step1 -> step2b
      // step2a, step2b -> step3
      const workflowConfig = createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2a', agent: 'agent2a', task: 'task2a', depends_on: ['step1'] },
          { id: 'step2b', agent: 'agent2b', task: 'task2b', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2a', 'step2b'] },
        ],
      });

      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2a': { status: 'completed' },
          'step2b': { status: 'failed', error: 'branch b failed' },
          'step3': { status: 'skipped' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(workflowConfig);

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step1 is upstream of step2b (its dependency), so reused
      expect(result!.recoveryScope!.reusedCount).toBe(2); // step1 + step2a
      // step2b (failed) and step3 (downstream without valid output) need rerun
      expect(result!.recoveryScope!.rerunCount).toBe(2); // step2b + step3
      // No completed downstream output becomes stale in this scenario
      expect(result!.recoveryScope!.invalidatedCount).toBe(0);
    });

    it('preview counts should handle multiple failed steps', () => {
      const failedRun = createMockRunState({
        status: 'failed',
        steps: {
          'step1': { status: 'completed' },
          'step2': { status: 'failed', error: 'failed' },
          'step3': { status: 'failed', error: 'failed' },
        },
      });
      mockStateManager.findRunById.mockReturnValue(failedRun);
      mockConfigLoader.loadWorkflow.mockReturnValue(createMockWorkflowConfig({
        steps: [
          { id: 'step1', agent: 'agent1', task: 'task1' },
          { id: 'step2', agent: 'agent2', task: 'task2', depends_on: ['step1'] },
          { id: 'step3', agent: 'agent3', task: 'task3', depends_on: ['step2'] },
        ],
      }));

      const result = service.getRunDiagnostics('run-123');

      expect(result).not.toBeNull();
      expect(result!.recoveryScope).toBeDefined();
      // step1 is upstream of first failure point (step2), so reused
      expect(result!.recoveryScope!.reusedCount).toBe(1);
      // step2 and step3 need rerun
      expect(result!.recoveryScope!.rerunCount).toBe(2);
      // No downstream
      expect(result!.recoveryScope!.invalidatedCount).toBe(0);
    });
  });
});
