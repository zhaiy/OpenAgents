import { describe, it, expect, beforeEach, vi } from 'vitest';
import type http from 'node:http';
import { WebRouter } from '../web/routes.js';
import type { WebAppContext } from '../app/context.js';

const mockWorkflowService = {
  listWorkflows: vi.fn(),
  getWorkflow: vi.fn(),
};

const mockRunService = {
  startRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunEvents: vi.fn(),
  getStepOutput: vi.fn(),
  getRunEval: vi.fn(),
  resumeRun: vi.fn(),
};

const mockGateService = {
  submitAction: vi.fn(),
};

const mockSettingsService = {
  getSettings: vi.fn(),
};

const mockWorkflowVisualService = {
  getVisualSummary: vi.fn(),
};

const mockRunVisualService = {
  getVisualState: vi.fn(),
  getTimeline: vi.fn(),
  getNodeState: vi.fn(),
};

const mockConfigDraftService = {
  listDraftsByWorkflow: vi.fn(),
  createDraft: vi.fn(),
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  deleteDraft: vi.fn(),
};

const mockRunCompareService = {
  compare: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
};

const mockDiagnosticsService = {
  getFailedRunsSummary: vi.fn(),
  getWaitingGatesSummary: vi.fn(),
  getRunDiagnostics: vi.fn(),
  getWorkflowQualitySummary: vi.fn(),
  getAllWorkflowQualitySummaries: vi.fn(),
};

const mockRunReuseService = {
  getReusableConfig: vi.fn(),
  createRerunPayload: vi.fn(),
  createEditedRerunPayload: vi.fn(),
  getRecoveryPreview: vi.fn(),
  createRecoveryPayload: vi.fn(),
  getRecoveryResult: vi.fn(),
};

const mockRunEventEmitter = {
  addClient: vi.fn(),
  removeClient: vi.fn(),
  getCurrentSequence: vi.fn(),
};

const mockContext = {
  workflowService: mockWorkflowService,
  runService: mockRunService,
  gateService: mockGateService,
  settingsService: mockSettingsService,
  runEventEmitter: mockRunEventEmitter,
  workflowVisualService: mockWorkflowVisualService,
  runVisualService: mockRunVisualService,
  configDraftService: mockConfigDraftService,
  runCompareService: mockRunCompareService,
  diagnosticsService: mockDiagnosticsService,
  runReuseService: mockRunReuseService,
} as unknown as WebAppContext;

function createMockRequest(method: string, url: string, body?: unknown): http.IncomingMessage {
  const req = {
    method,
    url,
    headers: {},
    on: vi.fn((event: string, callback: (chunk?: unknown) => void) => {
      if (event === 'data' && body) {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        callback();
      }
    }),
  };
  return req as unknown as http.IncomingMessage;
}

function createMockResponse(): { res: http.ServerResponse; data: unknown[] } {
  const data: unknown[] = [];
  return {
    res: {
      writeHead: () => { /* noop */ },
      write: (chunk: unknown) => { data.push(chunk); },
      end: (chunk?: unknown) => { if (chunk) data.push(chunk); },
    } as unknown as http.ServerResponse,
    data,
  };
}

function createMockResponseWithBody(body: unknown): { res: http.ServerResponse; data: unknown[]; req: http.IncomingMessage } {
  const data: unknown[] = [];
  const req = {
    method: 'POST',
    url: '',
    headers: { 'content-type': 'application/json' },
    on: vi.fn((event: string, callback: (chunk?: unknown) => void) => {
      if (event === 'data') {
        callback(Buffer.from(JSON.stringify(body)));
      }
      if (event === 'end') {
        callback();
      }
    }),
  } as unknown as http.IncomingMessage;
  return {
    res: {
      writeHead: () => { /* noop */ },
      write: (chunk: unknown) => { data.push(chunk); },
      end: (chunk?: unknown) => { if (chunk) data.push(chunk); },
    } as unknown as http.ServerResponse,
    data,
    req,
  };
}

describe('WebRouter', () => {
  let router: WebRouter;

  beforeEach(() => {
    router = new WebRouter(mockContext);
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('returns ok status', async () => {
      const req = createMockRequest('GET', '/api/health');
      const { res } = createMockResponse();
      const handled = await router.handle(req, res);
      expect(handled).toBe(true);
    });
  });

  describe('GET /api/workflows', () => {
    it('returns workflow list', async () => {
      const workflows = [{ id: 'wf1', name: 'Test', description: 'desc', stepCount: 2, hasGate: false, hasEval: false }];
      mockWorkflowService.listWorkflows.mockReturnValue(workflows);
      const req = createMockRequest('GET', '/api/workflows');
      const { res } = createMockResponse();
      await router.handle(req, res);
      expect(mockWorkflowService.listWorkflows).toHaveBeenCalled();
    });
  });

  describe('POST /api/runs', () => {
    it('starts a run', async () => {
      const result = { runId: 'run1', status: 'running' };
      mockRunService.startRun.mockReturnValue(result);
      const req = createMockRequest('POST', '/api/runs') as http.IncomingMessage & { on: ReturnType<typeof vi.fn> };
      (req as unknown as Record<string, unknown>)[Symbol.asyncIterator as unknown as string] = async function* () {
        yield Buffer.from(JSON.stringify({ workflowId: 'wf1' }));
      };
      const { res } = createMockResponse();
      const handled = await router.handle(req, res);
      expect(handled).toBe(true);
    });
  });

  describe('GET /api/runs', () => {
    it('returns runs list', async () => {
      mockRunService.listRuns.mockReturnValue([]);
      const req = createMockRequest('GET', '/api/runs');
      const { res } = createMockResponse();
      await router.handle(req, res);
      expect(mockRunService.listRuns).toHaveBeenCalledWith({});
    });

    it('passes filters to listRuns', async () => {
      mockRunService.listRuns.mockReturnValue([]);
      const req = createMockRequest('GET', '/api/runs?status=running&workflowId=wf1');
      const { res } = createMockResponse();
      await router.handle(req, res);
      expect(mockRunService.listRuns).toHaveBeenCalledWith({
        status: 'running',
        workflowId: 'wf1',
      });
    });
  });

  describe('GET /api/settings', () => {
    it('returns settings', async () => {
      const settings = { projectPath: '/test', locale: 'en', apiKeyConfigured: true, baseUrlConfigured: false };
      mockSettingsService.getSettings.mockReturnValue(settings);
      const req = createMockRequest('GET', '/api/settings');
      const { res } = createMockResponse();
      await router.handle(req, res);
      expect(mockSettingsService.getSettings).toHaveBeenCalled();
    });
  });

  describe('visual and diagnostics routes', () => {
    it('handles workflow visual summary', async () => {
      mockWorkflowVisualService.getVisualSummary.mockReturnValue({ workflowId: 'wf1', visualNodes: [], visualEdges: [] });
      const req = createMockRequest('GET', '/api/workflows/wf1/visual-summary');
      const { res } = createMockResponse();
      await router.handle(req, res);
      expect(mockWorkflowVisualService.getVisualSummary).toHaveBeenCalledWith('wf1');
    });

    it('handles run visual-state/timeline/node routes', async () => {
      mockRunVisualService.getVisualState.mockReturnValue({ runId: 'run1', nodeStates: {} });
      mockRunVisualService.getTimeline.mockReturnValue([]);
      mockRunVisualService.getNodeState.mockReturnValue({ nodeId: 'step1', status: 'running' });

      await router.handle(createMockRequest('GET', '/api/runs/run1/visual-state'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/runs/run1/timeline'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/runs/run1/node/step1'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/runs/run1/nodes/step1'), createMockResponse().res);

      expect(mockRunVisualService.getVisualState).toHaveBeenCalledWith('run1');
      expect(mockRunVisualService.getTimeline).toHaveBeenCalledWith('run1');
      expect(mockRunVisualService.getNodeState).toHaveBeenCalledWith('run1', 'step1');
    });

    it('handles diagnostics routes', async () => {
      mockDiagnosticsService.getFailedRunsSummary.mockReturnValue([]);
      mockDiagnosticsService.getWaitingGatesSummary.mockReturnValue([]);
      mockDiagnosticsService.getRunDiagnostics.mockReturnValue({ runId: 'run1' });
      mockDiagnosticsService.getAllWorkflowQualitySummaries.mockReturnValue([]);
      mockDiagnosticsService.getWorkflowQualitySummary.mockReturnValue({ workflowId: 'wf1' });
      await router.handle(createMockRequest('GET', '/api/diagnostics/failed-runs'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/diagnostics/waiting-gates'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/diagnostics/runs/run1'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/diagnostics/quality-summaries?limit=5'), createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/diagnostics/workflows/wf1/quality?limit=3'), createMockResponse().res);
      expect(mockDiagnosticsService.getFailedRunsSummary).toHaveBeenCalled();
      expect(mockDiagnosticsService.getWaitingGatesSummary).toHaveBeenCalled();
      expect(mockDiagnosticsService.getRunDiagnostics).toHaveBeenCalledWith('run1');
      expect(mockDiagnosticsService.getAllWorkflowQualitySummaries).toHaveBeenCalledWith(5);
      expect(mockDiagnosticsService.getWorkflowQualitySummary).toHaveBeenCalledWith('wf1', 3);
    });
  });

  describe('draft, compare and rerun routes', () => {
    it('handles config draft CRUD routes', async () => {
      mockConfigDraftService.listDraftsByWorkflow.mockReturnValue([]);
      mockConfigDraftService.createDraft.mockReturnValue({ draftId: 'd1' });
      mockConfigDraftService.getDraft.mockReturnValue({ draftId: 'd1' });
      mockConfigDraftService.updateDraft.mockReturnValue({ draftId: 'd1' });
      mockConfigDraftService.deleteDraft.mockReturnValue(true);

      await router.handle(createMockRequest('GET', '/api/workflows/wf1/drafts'), createMockResponse().res);

      const postReq = createMockRequest('POST', '/api/workflows/wf1/drafts') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ name: 'd1', inputData: {} }));
      };
      await router.handle(postReq, createMockResponse().res);

      await router.handle(createMockRequest('GET', '/api/workflows/wf1/drafts/d1'), createMockResponse().res);

      const patchReq = createMockRequest('PATCH', '/api/workflows/wf1/drafts/d1') as http.IncomingMessage;
      (patchReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ name: 'new' }));
      };
      await router.handle(patchReq, createMockResponse().res);

      await router.handle(createMockRequest('DELETE', '/api/workflows/wf1/drafts/d1'), createMockResponse().res);

      expect(mockConfigDraftService.listDraftsByWorkflow).toHaveBeenCalledWith('wf1');
      expect(mockConfigDraftService.createDraft).toHaveBeenCalled();
      expect(mockConfigDraftService.getDraft).toHaveBeenCalledWith('d1');
      expect(mockConfigDraftService.updateDraft).toHaveBeenCalledWith('d1', { name: 'new' });
      expect(mockConfigDraftService.deleteDraft).toHaveBeenCalledWith('d1');
    });

    it('handles compare session routes', async () => {
      mockRunCompareService.createSession.mockReturnValue({ sessionId: 'c1' });
      mockRunCompareService.getSession.mockReturnValue({ sessionId: 'c1' });
      mockRunCompareService.deleteSession.mockReturnValue(true);

      const postReq = createMockRequest('POST', '/api/compare') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ runAId: 'a', runBId: 'b' }));
      };
      await router.handle(postReq, createMockResponse().res);
      await router.handle(createMockRequest('GET', '/api/compare/c1'), createMockResponse().res);
      await router.handle(createMockRequest('DELETE', '/api/compare/c1'), createMockResponse().res);

      expect(mockRunCompareService.createSession).toHaveBeenCalledWith('a', 'b');
      expect(mockRunCompareService.getSession).toHaveBeenCalledWith('c1');
      expect(mockRunCompareService.deleteSession).toHaveBeenCalledWith('c1');
    });

    it('handles reusable config and rerun routes', async () => {
      mockRunReuseService.getReusableConfig.mockReturnValue({ workflowId: 'wf1' });
      mockRunReuseService.createRerunPayload.mockReturnValue({ workflowId: 'wf1', input: 'x' });
      mockRunReuseService.createEditedRerunPayload.mockReturnValue({ workflowId: 'wf1', input: 'x' });
      mockRunService.startRun.mockReturnValue({ runId: 'run-next', status: 'running' });

      await router.handle(createMockRequest('GET', '/api/runs/run1/reusable-config'), createMockResponse().res);
      await router.handle(createMockRequest('POST', '/api/runs/run1/rerun'), createMockResponse().res);

      const postReq = createMockRequest('POST', '/api/runs/run1/rerun-with-edits') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ inputData: { q: 1 }, runtimeOptions: { autoApprove: true } }));
      };
      await router.handle(postReq, createMockResponse().res);

      expect(mockRunReuseService.getReusableConfig).toHaveBeenCalledWith('run1');
      expect(mockRunReuseService.createRerunPayload).toHaveBeenCalledWith('run1');
      expect(mockRunReuseService.createEditedRerunPayload).toHaveBeenCalledWith('run1', { q: 1 }, { autoApprove: true });
      expect(mockRunService.startRun).toHaveBeenCalledTimes(2);
    });

    it('handles recovery preview and recover routes', async () => {
      mockRunReuseService.getRecoveryPreview.mockReturnValue({
        sourceRun: { runId: 'run1', status: 'failed', failedAt: Date.now(), failedNodeIds: ['step2'] },
        workflow: { workflowId: 'wf1', name: 'Test', stepCount: 2 },
        reusedSteps: [{ stepId: 'step1', currentStatus: 'completed', recoveryAction: 'reused', reason: 'Completed' }],
        rerunSteps: [{ stepId: 'step2', currentStatus: 'failed', recoveryAction: 'rerun', reason: 'Failed' }],
        invalidatedSteps: [],
        atRiskSteps: [],
        warnings: [],
        riskLevel: 'medium',
        summary: 'Will reuse 1 step(s) from source run.',
      });
      mockRunReuseService.createRecoveryPayload.mockReturnValue({
        workflowId: 'wf1',
        input: 'test',
        inputData: {},
        sourceRunId: 'run1',
        recoveryOptions: { resumeFromStep: 'step2', useCachedSteps: ['step1'] },
      });
      mockRunReuseService.getRecoveryResult.mockReturnValue({
        newRunId: 'run-recovered',
        sourceRunId: 'run1',
        status: 'running',
        reusedStepIds: ['step1'],
        rerunStepIds: ['step2'],
      });
      mockRunService.startRun.mockReturnValue({ runId: 'run-recovered', status: 'running' });

      // Test GET /api/runs/:runId/recovery-preview
      await router.handle(createMockRequest('GET', '/api/runs/run1/recovery-preview'), createMockResponse().res);
      expect(mockRunReuseService.getRecoveryPreview).toHaveBeenCalled();

      // Test GET /api/runs/:runId/recovery-preview with query params
      await router.handle(createMockRequest('GET', '/api/runs/run1/recovery-preview?resumeFromStep=step2'), createMockResponse().res);
      expect(mockRunReuseService.getRecoveryPreview).toHaveBeenLastCalledWith(
        expect.objectContaining({ sourceRunId: 'run1', resumeFromStep: 'step2' })
      );

      // Test POST /api/runs/:runId/recover
      const postReq = createMockRequest('POST', '/api/runs/run1/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ sourceRunId: 'run1', resumeFromStep: 'step2' }));
      };
      await router.handle(postReq, createMockResponse().res);
      expect(mockRunReuseService.createRecoveryPayload).toHaveBeenCalled();
      expect(mockRunService.startRun).toHaveBeenCalled();
    });

    it('returns NOT_FOUND when recovery preview on non-existent run', async () => {
      mockRunReuseService.getRecoveryPreview.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/runs/nonexistent/recovery-preview');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when recover on non-existent run', async () => {
      mockRunReuseService.createRecoveryPayload.mockReturnValue(null);

      const postReq = createMockRequest('POST', '/api/runs/nonexistent/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ sourceRunId: 'nonexistent' }));
      };
      const { res, data } = createMockResponse();
      await router.handle(postReq, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when recovery preview returns null (non-failed run)', async () => {
      mockRunReuseService.getRecoveryPreview.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/runs/completed-run/recovery-preview');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when createRecoveryPayload returns null', async () => {
      mockRunReuseService.createRecoveryPayload.mockReturnValue(null);

      const postReq = createMockRequest('POST', '/api/runs/run1/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ sourceRunId: 'run1' }));
      };
      const { res, data } = createMockResponse();
      await router.handle(postReq, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('parses recovery preview query parameters correctly', async () => {
      mockRunReuseService.getRecoveryPreview.mockReturnValue({
        sourceRun: { runId: 'run1', status: 'failed', failedAt: Date.now(), failedNodeIds: ['step2'] },
        workflow: { workflowId: 'wf1', name: 'Test', stepCount: 3 },
        reusedSteps: [],
        rerunSteps: [],
        invalidatedSteps: [],
        atRiskSteps: [],
        warnings: [],
        riskLevel: 'medium',
        summary: 'Test',
      });

      await router.handle(
        createMockRequest('GET', '/api/runs/run1/recovery-preview?resumeFromStep=step2&reuseSteps=step1,step2&forceRerunSteps=step3'),
        createMockResponse().res
      );

      expect(mockRunReuseService.getRecoveryPreview).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceRunId: 'run1',
          resumeFromStep: 'step2',
          reuseSteps: ['step1', 'step2'],
          forceRerunSteps: ['step3'],
        })
      );
    });

    it('handles recovery request with inputData override', async () => {
      mockRunReuseService.createRecoveryPayload.mockReturnValue({
        workflowId: 'wf1',
        input: 'test',
        inputData: { query: 'modified query' },
        sourceRunId: 'run1',
        recoveryOptions: { resumeFromStep: 'step2', useCachedSteps: ['step1'], forceRerunSteps: [] },
      });
      mockRunService.startRun.mockReturnValue({ runId: 'run-recovered', status: 'running' });

      const postReq = createMockRequest('POST', '/api/runs/run1/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({
          sourceRunId: 'run1',
          resumeFromStep: 'step2',
          inputData: { query: 'modified query' },
        }));
      };
      const { res, data } = createMockResponse();
      await router.handle(postReq, res);

      expect(mockRunReuseService.createRecoveryPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceRunId: 'run1',
          resumeFromStep: 'step2',
          inputData: { query: 'modified query' },
        })
      );
    });

    it('handles recovery request with runtimeOptions override', async () => {
      mockRunReuseService.createRecoveryPayload.mockReturnValue({
        workflowId: 'wf1',
        input: 'test',
        inputData: {},
        sourceRunId: 'run1',
        stream: false,
        autoApprove: true,
        noEval: false,
        recoveryOptions: { resumeFromStep: 'step2', useCachedSteps: [], forceRerunSteps: [] },
      });
      mockRunService.startRun.mockReturnValue({ runId: 'run-recovered', status: 'running' });

      const postReq = createMockRequest('POST', '/api/runs/run1/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({
          sourceRunId: 'run1',
          runtimeOptions: { autoApprove: true },
        }));
      };
      const { res, data } = createMockResponse();
      await router.handle(postReq, res);

      expect(mockRunReuseService.createRecoveryPayload).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceRunId: 'run1',
          runtimeOptions: { autoApprove: true },
        })
      );
    });

    it('returns recovery result with sourceRunId after successful recovery', async () => {
      mockRunReuseService.createRecoveryPayload.mockReturnValue({
        workflowId: 'wf1',
        input: 'test',
        inputData: {},
        sourceRunId: 'run1',
        recoveryOptions: { resumeFromStep: 'step2', useCachedSteps: ['step1'], forceRerunSteps: [] },
      });
      mockRunService.startRun.mockReturnValue({ runId: 'run-recovered', status: 'running' });
      mockRunReuseService.getRecoveryResult.mockReturnValue({
        newRunId: 'run-recovered',
        sourceRunId: 'run1',
        status: 'running',
        reusedStepIds: ['step1'],
        rerunStepIds: ['step2'],
      });

      const postReq = createMockRequest('POST', '/api/runs/run1/recover') as http.IncomingMessage;
      (postReq as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = async function* () {
        yield Buffer.from(JSON.stringify({ sourceRunId: 'run1' }));
      };
      const { res, data } = createMockResponse();
      await router.handle(postReq, res);

      const response = JSON.parse(String(data[0]));
      expect(response.newRunId).toBe('run-recovered');
      expect(response.sourceRunId).toBe('run1');
      expect(response.status).toBe('running');
    });
  });

  describe('SSE stream route', () => {
    it('sends sync event with lastEventId sequence and registers client', async () => {
      mockRunVisualService.getVisualState.mockReturnValue({ runId: 'run1', workflowId: 'wf1', nodeStates: {} });
      mockRunEventEmitter.getCurrentSequence.mockReturnValue(12);

      const req = createMockRequest('GET', '/api/runs/run1/stream?lastEventId=run1%3A5') as http.IncomingMessage;
      const { res, data } = createMockResponse();

      await router.handle(req, res);

      expect(mockRunVisualService.getVisualState).toHaveBeenCalledWith('run1');
      expect(mockRunEventEmitter.addClient).toHaveBeenCalled();
      expect(data.some((chunk) => String(chunk).includes('event: sync'))).toBe(true);
      expect(data.some((chunk) => String(chunk).includes('"lastSequence":5'))).toBe(true);
    });
  });

  describe('non-API routes', () => {
    it('returns false for non-API routes', async () => {
      const req = createMockRequest('GET', '/');
      const { res } = createMockResponse();
      const handled = await router.handle(req, res);
      expect(handled).toBe(false);
    });
  });

  // =============================================================================
  // N1: DTO/API Contract Tests
  // =============================================================================

  describe('RunSummary DTO contract', () => {
    it('returns RunSummary with all required fields', async () => {
      const mockRunSummary = {
        runId: 'run1',
        workflowId: 'wf1',
        workflowName: 'Test Workflow',
        status: 'completed',
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        durationMs: 1000,
        stepCount: 3,
        completedStepCount: 3,
      };
      mockRunService.listRuns.mockReturnValue([mockRunSummary]);

      const req = createMockRequest('GET', '/api/runs');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toBeInstanceOf(Array);
      expect(response[0]).toHaveProperty('runId');
      expect(response[0]).toHaveProperty('workflowId');
      expect(response[0]).toHaveProperty('workflowName');
      expect(response[0]).toHaveProperty('status');
      expect(response[0]).toHaveProperty('startedAt');
      expect(response[0]).toHaveProperty('stepCount');
      expect(response[0]).toHaveProperty('completedStepCount');
      expect(typeof response[0].startedAt).toBe('number');
    });
  });

  describe('RunDetail DTO contract', () => {
    it('returns RunDetail with all required fields', async () => {
      const mockRunDetail = {
        runId: 'run1',
        workflowId: 'wf1',
        workflowName: 'Test Workflow',
        status: 'completed',
        input: 'test input',
        inputData: { query: 'test' },
        startedAt: Date.now(),
        completedAt: Date.now() + 1000,
        durationMs: 1000,
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        steps: [
          {
            stepId: 'step1',
            name: 'Step 1',
            status: 'completed',
            startedAt: Date.now(),
            completedAt: Date.now() + 500,
            durationMs: 500,
          },
        ],
      };
      mockRunService.getRun.mockReturnValue(mockRunDetail);

      const req = createMockRequest('GET', '/api/runs/run1');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('runId');
      expect(response).toHaveProperty('workflowId');
      expect(response).toHaveProperty('workflowName');
      expect(response).toHaveProperty('status');
      expect(response).toHaveProperty('startedAt');
      expect(response).toHaveProperty('steps');
      expect(typeof response.startedAt).toBe('number');
      expect(response.steps).toBeInstanceOf(Array);
      expect(response.steps[0]).toHaveProperty('stepId');
      expect(response.steps[0]).toHaveProperty('name');
      expect(response.steps[0]).toHaveProperty('status');
    });
  });

  describe('Error response structure', () => {
    it('returns unified error structure for NOT_FOUND', async () => {
      mockWorkflowVisualService.getVisualSummary.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/workflows/nonexistent/visual-summary');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns unified error structure for BAD_REQUEST', async () => {
      // Clear all mocks to ensure clean state
      vi.clearAllMocks();

      // Request compare without required query parameters
      const req = createMockRequest('GET', '/api/runs/compare?runA='); // Missing runB
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response.error.code).toBe('BAD_REQUEST');
    });

    it('returns unified error structure for comparison session not found', async () => {
      mockRunCompareService.getSession.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/compare/nonexistent');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error).toHaveProperty('code');
      expect(response.error).toHaveProperty('message');
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  // =============================================================================
  // N3: Main Flow Closure Tests
  // =============================================================================

  describe('Rerun error handling (S7/S11)', () => {
    it('returns NOT_FOUND when rerun is called on non-existent run', async () => {
      mockRunReuseService.createRerunPayload.mockReturnValue(null);

      const req = createMockRequest('POST', '/api/runs/nonexistent/rerun');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
      expect(response.error.message).toBe('Run not found');
    });

    it('returns NOT_FOUND when rerun-with-edits is called on non-existent run', async () => {
      mockRunReuseService.createEditedRerunPayload.mockReturnValue(null);

      const req = createMockRequest('POST', '/api/runs/nonexistent/rerun-with-edits') as http.IncomingMessage & { on: ReturnType<typeof vi.fn> };
      (req as unknown as Record<string, unknown>)[Symbol.asyncIterator as unknown as string] = async function* () {
        yield Buffer.from(JSON.stringify({ inputData: {} }));
      };
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('starts new run when rerun is called on existing run', async () => {
      mockRunReuseService.createRerunPayload.mockReturnValue({
        workflowId: 'wf1',
        input: 'test',
        inputData: { query: 'test' },
        stream: true,
      });
      mockRunService.startRun.mockReturnValue({ runId: 'run2', status: 'running' });

      const req = createMockRequest('POST', '/api/runs/run1/rerun');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('runId');
      expect(response).toHaveProperty('status');
      expect(response.runId).toBe('run2');
    });
  });

  describe('Reusable config error handling (S11)', () => {
    it('returns NOT_FOUND when getting reusable config for non-existent run', async () => {
      mockRunReuseService.getReusableConfig.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/runs/nonexistent/reusable-config');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Draft error handling (S13)', () => {
    it('returns NOT_FOUND when getting non-existent draft', async () => {
      mockConfigDraftService.getDraft.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/workflows/wf1/drafts/nonexistent');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when updating non-existent draft', async () => {
      mockConfigDraftService.updateDraft.mockReturnValue(null);

      const req = createMockRequest('PATCH', '/api/workflows/wf1/drafts/nonexistent') as http.IncomingMessage & { on: ReturnType<typeof vi.fn> };
      (req as unknown as Record<string, unknown>)[Symbol.asyncIterator as unknown as string] = async function* () {
        yield Buffer.from(JSON.stringify({ name: 'Updated' }));
      };
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when deleting non-existent draft', async () => {
      mockConfigDraftService.deleteDraft.mockReturnValue(false);

      const req = createMockRequest('DELETE', '/api/workflows/wf1/drafts/nonexistent');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Run visual state error handling (S11)', () => {
    it('returns NOT_FOUND when getting visual state for non-existent run', async () => {
      mockRunVisualService.getVisualState.mockImplementation(() => {
        throw new Error('Run not found');
      });

      const req = createMockRequest('GET', '/api/runs/nonexistent/visual-state');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when getting timeline for non-existent run', async () => {
      mockRunVisualService.getTimeline.mockImplementation(() => {
        throw new Error('Run not found');
      });

      const req = createMockRequest('GET', '/api/runs/nonexistent/timeline');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });

  describe('Compare session error handling (S14)', () => {
    it('returns NOT_FOUND when getting non-existent compare session', async () => {
      mockRunCompareService.getSession.mockReturnValue(null);

      const req = createMockRequest('GET', '/api/compare/sessions/nonexistent');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('returns NOT_FOUND when deleting non-existent compare session', async () => {
      mockRunCompareService.deleteSession.mockReturnValue(false);

      const req = createMockRequest('DELETE', '/api/compare/sessions/nonexistent');
      const { res, data } = createMockResponse();
      await router.handle(req, res);

      const response = JSON.parse(String(data[0]));
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe('NOT_FOUND');
    });
  });
});
