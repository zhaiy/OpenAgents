/**
 * Web Router - N8 Refactored
 *
 * Routes are organized by functional groups while maintaining
 * a single handle() method for backward compatibility.
 *
 * Low-risk refactorings applied:
 * - Route matching helper functions
 * - Parameter decoding helpers
 * - Consistent error handling patterns
 * - Functional grouping with clear sections
 */
import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';

import type { WebAppContext } from '../app/context.js';
import type { GateActionRequestDto, RecoveryRequestDto, RunStartRequestDto, ApiErrorCode, ApiErrorResponse } from '../app/dto.js';

// =============================================================================
// Response Helpers
// =============================================================================

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendError(
  res: http.ServerResponse,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
): void {
  const errorResponse: ApiErrorResponse = {
    error: { code, message, details },
  };
  sendJson(res, statusCode, errorResponse);
}

function sendNotFound(res: http.ServerResponse, message = 'Not Found'): void {
  sendError(res, 404, 'NOT_FOUND', message);
}

function sendBadRequest(res: http.ServerResponse, message: string, details?: unknown): void {
  sendError(res, 400, 'BAD_REQUEST', message, details);
}

function sendValidationError(res: http.ServerResponse, message: string): void {
  sendError(res, 400, 'VALIDATION_ERROR', message);
}

// =============================================================================
// Request Helpers
// =============================================================================

async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {} as T;
  }
  return JSON.parse(raw) as T;
}

// =============================================================================
// Route Matching Helpers
// =============================================================================

type RouteMatch = RegExpMatchArray;

/**
 * Match a route pattern and return the match result.
 * Centralizes route matching logic for consistency.
 */
function matchRoute(method: string, expectedMethod: string, pathname: string, pattern: RegExp): RouteMatch | null {
  if (method !== expectedMethod) return null;
  return pathname.match(pattern);
}

/**
 * Decode a URL parameter from a route match.
 * Centralizes URL decoding for consistency.
 */
function decodeParam(match: RegExpMatchArray, index: number): string {
  return decodeURIComponent(match[index]);
}

/**
 * Extract query parameters with type safety.
 */
function getQueryParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key);
  return value ?? undefined;
}

// =============================================================================
// Web Router
// =============================================================================

export class WebRouter {
  constructor(private readonly context: WebAppContext) {}

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const method = req.method ?? 'GET';
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = parsed.pathname;
    const params = parsed.searchParams;

    if (!pathname.startsWith('/api')) {
      return false;
    }

    try {
      // =======================================================================
      // Health & Settings
      // =======================================================================

      if (matchRoute(method, 'GET', pathname, /^\/api\/health$/)) {
        sendJson(res, 200, { ok: true });
        return true;
      }

      if (matchRoute(method, 'GET', pathname, /^\/api\/settings$/)) {
        sendJson(res, 200, this.context.settingsService.getSettings());
        return true;
      }

      // =======================================================================
      // Workflows
      // =======================================================================

      if (matchRoute(method, 'GET', pathname, /^\/api\/workflows$/)) {
        sendJson(res, 200, this.context.workflowService.listWorkflows());
        return true;
      }

      let match = matchRoute(method, 'GET', pathname, /^\/api\/workflows\/([^/]+)$/);
      if (match) {
        const workflowId = decodeParam(match, 1);
        sendJson(res, 200, this.context.workflowService.getWorkflow(workflowId));
        return true;
      }

      // Workflow Visual Summary
      match = matchRoute(method, 'GET', pathname, /^\/api\/workflows\/([^/]+)\/visual-summary$/);
      if (match) {
        const workflowId = decodeParam(match, 1);
        const summary = this.context.workflowVisualService.getVisualSummary(workflowId);
        if (!summary) {
          sendNotFound(res, 'Workflow not found');
          return true;
        }
        sendJson(res, 200, summary);
        return true;
      }

      // =======================================================================
      // Runs - List & Create
      // =======================================================================

      if (matchRoute(method, 'POST', pathname, /^\/api\/runs$/)) {
        const body = await parseJsonBody<RunStartRequestDto>(req);
        sendJson(res, 200, this.context.runService.startRun(body));
        return true;
      }

      if (matchRoute(method, 'GET', pathname, /^\/api\/runs$/)) {
        sendJson(
          res,
          200,
          this.context.runService.listRuns({
            status: getQueryParam(params, 'status') as 'running' | 'completed' | 'failed' | 'interrupted' | undefined,
            workflowId: getQueryParam(params, 'workflowId'),
          }),
        );
        return true;
      }

      // =======================================================================
      // Runs - Comparison (must be before /:runId routes)
      // =======================================================================

      if (matchRoute(method, 'GET', pathname, /^\/api\/runs\/compare$/)) {
        const runA = getQueryParam(params, 'runA');
        const runB = getQueryParam(params, 'runB');
        if (!runA || !runB) {
          sendBadRequest(res, 'Both runA and runB query parameters are required');
          return true;
        }
        try {
          const comparison = this.context.runCompareService.compare(runA, runB);
          sendJson(res, 200, comparison);
        } catch {
          sendNotFound(res, 'Run not found');
        }
        return true;
      }

      // =======================================================================
      // Runs - Detail & Actions
      // =======================================================================

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)$/);
      if (match) {
        const runId = decodeParam(match, 1);
        sendJson(res, 200, this.context.runService.getRun(runId));
        return true;
      }

      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/resume$/);
      if (match) {
        const runId = decodeParam(match, 1);
        sendJson(res, 200, this.context.runService.resumeRun(runId));
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/events$/);
      if (match) {
        const runId = decodeParam(match, 1);
        sendJson(res, 200, this.context.runService.getRunEvents(runId));
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/eval$/);
      if (match) {
        const runId = decodeParam(match, 1);
        sendJson(res, 200, this.context.runService.getRunEval(runId));
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/steps\/([^/]+)\/output$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const stepId = decodeParam(match, 2);
        const text = this.context.runService.getStepOutput(runId, stepId);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(text);
        return true;
      }

      // =======================================================================
      // Runs - Streaming
      // =======================================================================

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/stream$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const clientId = randomUUID();

        const lastEventId =
          (req.headers['last-event-id'] as string | undefined) ??
          getQueryParam(params, 'lastEventId') ??
          undefined;
        const lastSequence = lastEventId ? parseInt(lastEventId.split(':').pop() ?? '0', 10) : 0;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        try {
          const visualState = this.context.runVisualService.getVisualState(runId);
          const currentSeq = this.context.runEventEmitter.getCurrentSequence(runId);
          const initialSync = {
            type: 'sync',
            runId,
            visualState,
            sequence: currentSeq,
            lastSequence,
            ts: Date.now(),
          };
          res.write(`id: sync:${runId}:${currentSeq}\nevent: sync\ndata: ${JSON.stringify(initialSync)}\n\n`);
        } catch {
          res.write(`event: sync\ndata: ${JSON.stringify({ runId, ts: Date.now() })}\n\n`);
        }

        this.context.runEventEmitter.addClient(runId, clientId, res);
        req.on('close', () => {
          this.context.runEventEmitter.removeClient(runId, clientId);
        });
        return true;
      }

      // =======================================================================
      // Runs - Gates
      // =======================================================================

      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/gates\/([^/]+)\/action$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const stepId = decodeParam(match, 2);
        const body = await parseJsonBody<GateActionRequestDto>(req);
        sendJson(res, 200, this.context.gateService.submitAction(runId, stepId, body));
        return true;
      }

      // =======================================================================
      // Runs - Visual State
      // =======================================================================

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/visual-state$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const visualState = this.context.runVisualService.getVisualState(runId);
          sendJson(res, 200, visualState);
        } catch {
          sendNotFound(res, 'Run not found');
        }
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/timeline$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const timeline = this.context.runVisualService.getTimeline(runId);
          sendJson(res, 200, timeline);
        } catch {
          sendNotFound(res, 'Run not found');
        }
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/node(?:s)?\/([^/]+)$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const nodeId = decodeParam(match, 2);
        try {
          const nodeState = this.context.runVisualService.getNodeState(runId, nodeId);
          if (!nodeState) {
            sendNotFound(res, 'Node not found');
            return true;
          }
          sendJson(res, 200, nodeState);
        } catch {
          sendNotFound(res, 'Run not found');
        }
        return true;
      }

      // =======================================================================
      // Runs - Reuse & Rerun
      // =======================================================================

      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/reusable-config$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const config = this.context.runReuseService.getReusableConfig(runId);
        if (!config) {
          sendNotFound(res, 'Run not found');
          return true;
        }
        sendJson(res, 200, config);
        return true;
      }

      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/rerun-preview$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const body = await parseJsonBody<{ inputData?: Record<string, unknown>; runtimeOptions?: { stream?: boolean; autoApprove?: boolean; noEval?: boolean } }>(req);
          const preview = this.context.runReuseService.getRerunPreview(runId, body);
          if (!preview) {
            sendNotFound(res, 'Run not found');
            return true;
          }
          sendJson(res, 200, preview);
        } catch (error) {
          sendValidationError(res, error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/rerun$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const payload = this.context.runReuseService.createRerunPayload(runId);
          if (!payload) {
            sendNotFound(res, 'Run not found');
            return true;
          }
          const newRun = this.context.runService.startRun(payload);
          sendJson(res, 200, { runId: newRun.runId, status: newRun.status });
        } catch (error) {
          sendValidationError(res, error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/rerun-with-edits$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const body = await parseJsonBody<{
            inputData?: Record<string, unknown>;
            runtimeOptions?: { stream?: boolean; autoApprove?: boolean; noEval?: boolean };
          }>(req);
          const payload = this.context.runReuseService.createEditedRerunPayload(
            runId,
            body.inputData || {},
            body.runtimeOptions,
          );
          if (!payload) {
            sendNotFound(res, 'Run not found');
            return true;
          }
          const newRun = this.context.runService.startRun(payload);
          sendJson(res, 200, { runId: newRun.runId, status: newRun.status });
        } catch (error) {
          sendValidationError(res, error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      // =======================================================================
      // Runs - Recovery (M1 - Node-Level Recovery)
      // =======================================================================

      // GET /api/runs/:runId/recovery-preview - Preview what recovery would do
      match = matchRoute(method, 'GET', pathname, /^\/api\/runs\/([^/]+)\/recovery-preview$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          // Parse query params for optional recovery options
          const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
          const resumeFromStep = parsed.searchParams.get('resumeFromStep') ?? undefined;
          const reuseStepsStr = parsed.searchParams.get('reuseSteps');
          const forceRerunStepsStr = parsed.searchParams.get('forceRerunSteps');

          const recoveryRequest: RecoveryRequestDto = {
            sourceRunId: runId,
            resumeFromStep,
            reuseSteps: reuseStepsStr ? reuseStepsStr.split(',') : undefined,
            forceRerunSteps: forceRerunStepsStr ? forceRerunStepsStr.split(',') : undefined,
          };

          const preview = this.context.runReuseService.getRecoveryPreview(recoveryRequest);
          if (!preview) {
            sendNotFound(res, 'Run not found or not a failed run');
            return true;
          }
          sendJson(res, 200, preview);
        } catch (error) {
          sendValidationError(res, error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      // POST /api/runs/:runId/recover - Execute recovery
      match = matchRoute(method, 'POST', pathname, /^\/api\/runs\/([^/]+)\/recover$/);
      if (match) {
        const runId = decodeParam(match, 1);
        try {
          const body = await parseJsonBody<RecoveryRequestDto>(req);
          const recoveryRequest: RecoveryRequestDto = {
            sourceRunId: runId,
            resumeFromStep: body.resumeFromStep,
            reuseSteps: body.reuseSteps,
            forceRerunSteps: body.forceRerunSteps,
            inputData: body.inputData,
            runtimeOptions: body.runtimeOptions,
          };

          const payload = this.context.runReuseService.createRecoveryPayload(recoveryRequest);
          if (!payload) {
            sendNotFound(res, 'Run not found or not a failed run');
            return true;
          }
          const newRun = this.context.runService.startRun(payload);
          sendJson(res, 200, {
            newRunId: newRun.runId,
            sourceRunId: runId,
            status: 'running',
            reusedStepIds: payload.recoveryOptions?.useCachedSteps ?? [],
            rerunStepIds: payload.recoveryOptions?.forceRerunSteps ?? [],
          });
        } catch (error) {
          sendValidationError(res, error instanceof Error ? error.message : String(error));
        }
        return true;
      }

      // =======================================================================
      // Diagnostics
      // =======================================================================

      if (matchRoute(method, 'GET', pathname, /^\/api\/diagnostics\/failed-runs$/)) {
        const failedRuns = this.context.diagnosticsService.getFailedRunsSummary();
        sendJson(res, 200, failedRuns);
        return true;
      }

      if (matchRoute(method, 'GET', pathname, /^\/api\/diagnostics\/waiting-gates$/)) {
        const waitingGates = this.context.diagnosticsService.getWaitingGatesSummary();
        sendJson(res, 200, waitingGates);
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/diagnostics\/quality-summaries$/);
      if (match) {
        const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
        const limit = Number.parseInt(parsed.searchParams.get('limit') ?? '10', 10);
        const summaries = this.context.diagnosticsService.getAllWorkflowQualitySummaries(
          Number.isFinite(limit) && limit > 0 ? limit : 10,
        );
        sendJson(res, 200, summaries);
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/diagnostics\/workflows\/([^/]+)\/quality$/);
      if (match) {
        const workflowId = decodeParam(match, 1);
        const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
        const limit = Number.parseInt(parsed.searchParams.get('limit') ?? '10', 10);
        const summary = this.context.diagnosticsService.getWorkflowQualitySummary(
          workflowId,
          Number.isFinite(limit) && limit > 0 ? limit : 10,
        );
        if (!summary) {
          sendNotFound(res, 'Workflow quality summary not found');
          return true;
        }
        sendJson(res, 200, summary);
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/diagnostics\/runs\/([^/]+)$/);
      if (match) {
        const runId = decodeParam(match, 1);
        const diagnostics = this.context.diagnosticsService.getRunDiagnostics(runId);
        if (!diagnostics) {
          sendNotFound(res, 'Run not found');
          return true;
        }
        sendJson(res, 200, diagnostics);
        return true;
      }

      // =======================================================================
      // Config Drafts
      // =======================================================================

      match = matchRoute(method, 'GET', pathname, /^\/api\/workflows\/([^/]+)\/drafts$/);
      if (match) {
        const workflowId = decodeParam(match, 1);
        const drafts = this.context.configDraftService.listDraftsByWorkflow(workflowId);
        sendJson(res, 200, drafts);
        return true;
      }

      match = matchRoute(method, 'POST', pathname, /^\/api\/workflows\/([^/]+)\/drafts$/);
      if (match) {
        const workflowId = decodeParam(match, 1);
        const body = await parseJsonBody<{
          name: string;
          inputData: Record<string, unknown>;
          runtimeOptions?: { stream?: boolean; autoApprove?: boolean; noEval?: boolean };
        }>(req);
        const draft = this.context.configDraftService.createDraft({
          workflowId,
          name: body.name,
          inputData: body.inputData,
          runtimeOptions: body.runtimeOptions,
        });
        sendJson(res, 201, draft);
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/workflows\/([^/]+)\/drafts\/([^/]+)$/);
      if (match) {
        const draftId = decodeParam(match, 2);
        const draft = this.context.configDraftService.getDraft(draftId);
        if (!draft) {
          sendNotFound(res, 'Draft not found');
          return true;
        }
        sendJson(res, 200, draft);
        return true;
      }

      match = matchRoute(method, 'PATCH', pathname, /^\/api\/workflows\/([^/]+)\/drafts\/([^/]+)$/);
      if (match) {
        const draftId = decodeParam(match, 2);
        const body = await parseJsonBody<{
          name?: string;
          inputData?: Record<string, unknown>;
          runtimeOptions?: { stream?: boolean; autoApprove?: boolean; noEval?: boolean };
        }>(req);
        const draft = this.context.configDraftService.updateDraft(draftId, body);
        if (!draft) {
          sendNotFound(res, 'Draft not found');
          return true;
        }
        sendJson(res, 200, draft);
        return true;
      }

      match = matchRoute(method, 'DELETE', pathname, /^\/api\/workflows\/([^/]+)\/drafts\/([^/]+)$/);
      if (match) {
        const draftId = decodeParam(match, 2);
        const deleted = this.context.configDraftService.deleteDraft(draftId);
        if (!deleted) {
          sendNotFound(res, 'Draft not found');
          return true;
        }
        sendJson(res, 204, {});
        return true;
      }

      // =======================================================================
      // Comparison Sessions
      // =======================================================================

      if (matchRoute(method, 'POST', pathname, /^\/api\/compare$/)) {
        const body = await parseJsonBody<{ runAId?: string; runBId?: string }>(req);
        if (!body.runAId || !body.runBId) {
          sendBadRequest(res, 'runAId and runBId are required');
          return true;
        }
        try {
          sendJson(res, 201, this.context.runCompareService.createSession(body.runAId, body.runBId));
        } catch {
          sendNotFound(res, 'Run not found');
        }
        return true;
      }

      match = matchRoute(method, 'GET', pathname, /^\/api\/compare\/([^/]+)$/);
      if (match) {
        const sessionId = decodeParam(match, 1);
        const session = this.context.runCompareService.getSession(sessionId);
        if (!session) {
          sendNotFound(res, 'Comparison session not found');
          return true;
        }
        sendJson(res, 200, session);
        return true;
      }

      match = matchRoute(method, 'DELETE', pathname, /^\/api\/compare\/([^/]+)$/);
      if (match) {
        const sessionId = decodeParam(match, 1);
        const deleted = this.context.runCompareService.deleteSession(sessionId);
        if (!deleted) {
          sendNotFound(res, 'Comparison session not found');
          return true;
        }
        sendJson(res, 204, {});
        return true;
      }

      // =======================================================================
      // Fallback
      // =======================================================================

      sendNotFound(res, 'Not Found');
      return true;
    } catch (error) {
      sendError(res, 400, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
      return true;
    }
  }
}
