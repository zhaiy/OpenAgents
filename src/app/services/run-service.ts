import fs from 'node:fs';
import path from 'node:path';

import { ConfigLoader } from '../../config/loader.js';
import { StateManager } from '../../engine/state.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { EventLogger } from '../../output/logger.js';
import { OutputWriter } from '../../output/writer.js';
import { createRuntime } from '../../runtime/factory.js';
import { StepCache } from '../../engine/cache.js';
import { GateManager, DeferredGateProvider } from '../../engine/gate.js';
import type { AgentRuntime, ProjectConfig, RunStatus, RuntimeType } from '../../types/index.js';
import { EvalRunner } from '../../eval/runner.js';
import type {
  RunDetailDto,
  RunStartRequestDto,
  RunStartResponseDto,
  RunSummaryDto,
  WebRunEvent,
  RunCostSummary,
  StepCostInfo,
} from '../dto.js';
import { RunEventEmitter } from '../events/run-event-emitter.js';
import { WebEventHandler } from '../events/web-event-handler.js';
import { RunRegistry } from './run-registry.js';
import { aggregateTokenUsageOptional, computeDuration } from './run-metrics.js';

interface RunServiceDeps {
  loader: ConfigLoader;
  stateManager: StateManager;
  outputWriter: OutputWriter;
  cache: StepCache;
  eventEmitter: RunEventEmitter;
  runRegistry: RunRegistry;
  gateProvider: DeferredGateProvider;
  streamThrottleMs?: number;
}

export class RunService {
  constructor(private readonly deps: RunServiceDeps) {}

  startRun(request: RunStartRequestDto): RunStartResponseDto {
    const runId = this.deps.stateManager.generateRunId();
    const { engine, eventHandler } = this.buildWebEngine({ autoApprove: request.autoApprove });

    // Extract recovery info from request if present
    const recoveryInfo = request.recoveryOptions
      ? {
          reusedStepIds: request.recoveryOptions.useCachedSteps ?? [],
          rerunStepIds: request.recoveryOptions.forceRerunSteps ?? [],
        }
      : undefined;

    const runPromise = engine.run(request.workflowId, request.input, {
      runId,
      inputData: request.inputData,
      stream: request.stream ?? true,
      noEval: request.noEval,
      sourceRunId: request.sourceRunId,
      recoveryInfo,
      sourceRunRelationship: request.sourceRunRelationship,
    });
    this.deps.runRegistry.register({
      runId,
      workflowId: request.workflowId,
      startedAt: Date.now(),
      eventHandler,
      promise: runPromise,
    });
    return {
      runId,
      status: 'running',
    };
  }

  resumeRun(runId: string, stream = true): RunStartResponseDto {
    const state = this.deps.stateManager.findRunById(runId);
    const { engine, eventHandler } = this.buildWebEngine();
    const runPromise = engine.resume(runId, { stream });
    this.deps.runRegistry.register({
      runId,
      workflowId: state.workflowId,
      startedAt: Date.now(),
      eventHandler,
      promise: runPromise,
    });
    return {
      runId,
      status: 'running',
    };
  }

  listRuns(filter?: { workflowId?: string; status?: RunStatus }): RunSummaryDto[] {
    const runs = this.deps.stateManager.listRuns(filter);
    return runs.map((run) => {
      const stepStates = Object.values(run.steps);
      const workflowName = this.getWorkflowName(run.workflowId);
      const durationMs = run.completedAt && run.startedAt
        ? run.completedAt - run.startedAt
        : undefined;

      return {
        runId: run.runId,
        workflowId: run.workflowId,
        workflowName,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        durationMs,
        stepCount: stepStates.length,
        completedStepCount: stepStates.filter((step) => step.status === 'completed').length,
        recoveredFrom: run.sourceRunId ? {
          runId: run.sourceRunId,
          recoveredAt: run.startedAt,
          reusedStepIds: run.recoveryInfo?.reusedStepIds ?? [],
          rerunStepIds: run.recoveryInfo?.rerunStepIds ?? [],
        } : undefined,
      };
    });
  }

  getRun(runId: string): RunDetailDto {
    const run = this.deps.stateManager.findRunById(runId);
    const workflowName = this.getWorkflowName(run.workflowId);
    const durationMs = run.completedAt && run.startedAt
      ? run.completedAt - run.startedAt
      : undefined;

    // Calculate total token usage from all steps
    const tokenUsage = aggregateTokenUsageOptional(run.steps);

    // Build step names map from workflow config (M5)
    const stepNames = this.buildStepNamesMap(run.workflowId);

    // Compute cost summary (M5)
    const costSummary = this.computeRunCostSummary(run.steps, stepNames);

    // Transform steps from Record to Array with frontend-compatible field names
    const stepsArray = Object.entries(run.steps).map(([stepId, step]) => {
      let output: string | undefined;
      if (step.outputFile) {
        try {
          output = this.getStepOutput(runId, stepId);
        } catch {
          output = undefined;
        }
      }

      return {
        stepId,
        name: stepNames[stepId] ?? stepId,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        output,
        error: step.error,
        durationMs: step.durationMs,
        tokenUsage: step.tokenUsage,
      };
    });

    return {
      runId: run.runId,
      workflowId: run.workflowId,
      workflowName,
      status: run.status,
      input: run.input,
      inputData: run.inputData,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs,
      tokenUsage,
      steps: stepsArray,
      recoveredFrom: run.sourceRunId ? {
        runId: run.sourceRunId,
        recoveredAt: run.startedAt,
        reusedStepIds: run.recoveryInfo?.reusedStepIds ?? [],
        rerunStepIds: run.recoveryInfo?.rerunStepIds ?? [],
      } : undefined,
      costSummary,
    };
  }

  getRunEvents(runId: string): WebRunEvent[] {
    const run = this.deps.stateManager.findRunById(runId);
    const runDir = this.deps.stateManager.getRunDir(run.workflowId, runId);
    const logger = new EventLogger(path.join(runDir, 'events.jsonl'));
    return logger.readAll().map((entry, index) => ({
      id: `${runId}:${entry.ts}:${index}`,
      ts: entry.ts,
      runId,
      type: entry.event,
      ...(entry.data as Record<string, unknown>),
    })) as WebRunEvent[];
  }

  getStepOutput(runId: string, stepId: string): string {
    const run = this.deps.stateManager.findRunById(runId);
    const step = run.steps[stepId];
    if (!step) {
      throw new Error(`Step "${stepId}" not found in run "${runId}"`);
    }
    if (!step.outputFile) {
      throw new Error(`Step "${stepId}" has no output file`);
    }
    const runDir = this.deps.stateManager.getRunDir(run.workflowId, runId);
    const filePath = path.resolve(runDir, step.outputFile);
    const runDirPrefix = runDir.endsWith(path.sep) ? runDir : `${runDir}${path.sep}`;
    if (!filePath.startsWith(runDirPrefix)) {
      throw new Error(`Step "${stepId}" output file points outside run directory`);
    }
    return fs.readFileSync(filePath, 'utf8');
  }

  /**
   * Build a map of stepId -> stepName from workflow config.
   * M5: Used for cost attribution.
   */
  private buildStepNamesMap(workflowId: string): Record<string, string> {
    try {
      const workflow = this.deps.loader.loadWorkflow(workflowId);
      const map: Record<string, string> = {};
      for (const step of workflow.steps) {
        map[step.id] = step.metadata?.displayName ?? step.id;
      }
      return map;
    } catch {
      return {};
    }
  }

  getRunEval(runId: string): unknown {
    const run = this.deps.stateManager.findRunById(runId);
    const projectConfig = this.deps.loader.loadProjectConfig();
    const outputBaseDir = path.resolve(this.deps.loader.getProjectRoot(), projectConfig.output.base_directory);
    const evalRunner = new EvalRunner(
      createRuntime as (type: 'llm-direct', projectConfig: ProjectConfig) => AgentRuntime,
      outputBaseDir,
      projectConfig,
    );
    return evalRunner.loadLastEval(run.workflowId, runId) ?? null;
  }

  private getWorkflowName(workflowId: string): string {
    try {
      const workflow = this.deps.loader.loadWorkflow(workflowId);
      return workflow.workflow.name ?? workflowId;
    } catch {
      return workflowId;
    }
  }

  /**
   * Compute cost summary for a run, identifying high-cost steps.
   * M5: Cost observation capability.
   */
  private computeRunCostSummary(
    steps: Record<string, { tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens: number }; durationMs?: number }>,
    stepNames?: Record<string, string>,
  ): RunCostSummary | undefined {
    const stepEntries = Object.entries(steps);

    // Calculate totals
    let totalTokens = 0;
    let totalDurationMs = 0;
    const stepCosts: StepCostInfo[] = [];

    for (const [stepId, step] of stepEntries) {
      const tokens = step.tokenUsage?.totalTokens;
      const durationMs = step.durationMs;

      if (tokens !== undefined) {
        totalTokens += tokens;
      }
      if (durationMs !== undefined) {
        totalDurationMs += durationMs;
      }

      // Only include steps with actual cost data
      if (tokens !== undefined || durationMs !== undefined) {
        stepCosts.push({
          stepId,
          name: stepNames?.[stepId] ?? stepId,
          tokens,
          durationMs,
        });
      }
    }

    // If no cost data, return undefined
    if (totalTokens === 0 && totalDurationMs === 0) {
      return undefined;
    }

    // Calculate percentages and sort
    const sortedByTokens = [...stepCosts]
      .filter(s => s.tokens !== undefined)
      .map(s => ({
        ...s,
        percentTokens: totalTokens > 0 ? Math.round((s.tokens! / totalTokens) * 10000) / 100 : undefined,
      }))
      .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0));

    const sortedByDuration = [...stepCosts]
      .filter(s => s.durationMs !== undefined)
      .map(s => ({
        ...s,
        percentDuration: totalDurationMs > 0 ? Math.round((s.durationMs! / totalDurationMs) * 10000) / 100 : undefined,
      }))
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));

    const tokenMeasuredSteps = stepEntries.filter(([, s]) => s.tokenUsage?.totalTokens !== undefined).length;
    const durationMeasuredSteps = stepEntries.filter(([, s]) => s.durationMs !== undefined).length;

    return {
      totalTokens: totalTokens > 0 ? totalTokens : undefined,
      totalDurationMs: totalDurationMs > 0 ? totalDurationMs : undefined,
      topTokensSteps: sortedByTokens.slice(0, 5), // Top 5 by tokens
      topDurationSteps: sortedByDuration.slice(0, 5), // Top 5 by duration
      avgTokensPerStep: tokenMeasuredSteps > 0 ? Math.round(totalTokens / tokenMeasuredSteps) : undefined,
      avgDurationMsPerStep: durationMeasuredSteps > 0 ? Math.round(totalDurationMs / durationMeasuredSteps) : undefined,
    };
  }

  private buildWebEngine(opts?: { autoApprove?: boolean }): { engine: WorkflowEngine; eventHandler: WebEventHandler } {
    const projectConfig = this.deps.loader.loadProjectConfig();
    const gateManager = new GateManager('en', { autoApprove: opts?.autoApprove }, this.deps.gateProvider);
    const eventHandler = new WebEventHandler(this.deps.eventEmitter, this.deps.streamThrottleMs);
    const engine = new WorkflowEngine({
      configLoader: this.deps.loader,
      stateManager: this.deps.stateManager,
      runtimeFactory: (type: RuntimeType, cfg: ProjectConfig) => createRuntime(type, cfg),
      outputWriter: this.deps.outputWriter,
      gateManager,
      eventHandler,
      cache: this.deps.cache,
    });

    // Ensure output base directory exists for run side effects.
    fs.mkdirSync(path.resolve(this.deps.loader.getProjectRoot(), projectConfig.output.base_directory), {
      recursive: true,
    });
    return { engine, eventHandler };
  }
}
