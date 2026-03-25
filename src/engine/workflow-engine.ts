import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { ConfigLoader } from '../config/loader.js';
import { GateRejectError, RuntimeError, WorkflowInterruptError } from '../errors.js';
import { EventLogger } from '../output/logger.js';
import { OutputWriter } from '../output/writer.js';
import { sendWebhookNotification } from '../output/notifier.js';
import type {
  AgentConfig,
  AgentRuntime,
  ProjectConfig,
  RunState,
  RuntimeType,
  SourceRunRelationship,
  StepConfig,
  StepSnapshot,
  WorkflowConfig,
  WorkflowSnapshot,
} from '../types/index.js';
import { processContext } from './context-processor.js';
import { GateManager } from './gate.js';
import { DAGParser } from './dag.js';
import { Scheduler } from './scheduler.js';
import { StateManager } from './state.js';
import { renderTemplate } from './template.js';
import type { EngineEventHandler } from './events.js';
import { StepCache } from './cache.js';
import { runScriptPostProcessor } from './post-processor.js';
import { buildSkillsContext } from '../skills/registry.js';

type RuntimeFactory = (type: RuntimeType, projectConfig: ProjectConfig, agentConfig?: AgentConfig) => AgentRuntime;

interface RunOptions {
  inputData?: Record<string, unknown>;
  stream?: boolean;
  noEval?: boolean;
  runId?: string;
  /** Source run ID if this run is a recovery/rerun */
  sourceRunId?: string;
  /** Recovery metadata for node-level recovery */
  recoveryInfo?: {
    reusedStepIds: string[];
    rerunStepIds: string[];
  };
  /** Explicit relationship type to source run for provenance. */
  sourceRunRelationship?: SourceRunRelationship;
}

interface RenderContext {
  input: string;
  inputs?: Record<string, unknown>;
  workflowId: string;
  runId: string;
  runDir: string;
  steps: Record<string, { outputFile?: string }>;
  processedContexts: Record<string, string>;
  skills: Record<string, { instructions: string; output_format?: string }>;
}

interface WorkflowEngineDeps {
  configLoader: ConfigLoader;
  stateManager: StateManager;
  runtimeFactory: RuntimeFactory;
  outputWriter: OutputWriter;
  gateManager: GateManager;
  eventHandler: EngineEventHandler;
  cache?: StepCache;
}

function getRuntimeErrorMeta(error: unknown): Record<string, unknown> {
  if (!(error instanceof RuntimeError) || !error.details) {
    return {};
  }
  return {
    httpStatus: error.details.httpStatus,
    responseBody: error.details.responseBody,
    isTimeout: error.details.isTimeout,
    timeoutSeconds: error.details.timeoutSeconds,
    runtimeCause: error.details.cause,
  };
}

export class WorkflowEngine {
  private readonly dagParser = new DAGParser();
  private interrupted = false;

  constructor(private readonly deps: WorkflowEngineDeps) {}

  async run(workflowId: string, input: string, options?: RunOptions): Promise<RunState> {
    const projectConfig = this.deps.configLoader.loadProjectConfig();
    const agents = this.deps.configLoader.loadAgents();
    const workflow = this.deps.configLoader.loadWorkflow(workflowId);
    this.deps.configLoader.validateReferences(agents, workflow);

    const plan = this.dagParser.parse(workflow.steps);
    const runId = options?.runId ?? this.deps.stateManager.generateRunId();
    const workflowSnapshot = this.buildWorkflowSnapshot(workflow, agents);
    const state = this.deps.stateManager.initRun(
      runId,
      workflow.workflow.id,
      input,
      plan.order,
      options?.inputData,
      {
        sourceRunId: options?.sourceRunId,
        recoveryInfo: options?.recoveryInfo,
        sourceRunRelationship: options?.sourceRunRelationship,
        workflowSnapshot,
      },
    );
    if (options?.sourceRunId && options.recoveryInfo?.reusedStepIds.length) {
      this.hydrateRecoveredSteps({
        workflowId: workflow.workflow.id,
        sourceRunId: options.sourceRunId,
        targetState: state,
        reusedStepIds: options.recoveryInfo.reusedStepIds,
      });
    }
    return this.executeWorkflow({
      projectConfig,
      agents,
      workflow,
      state,
      plan,
      isResume: false,
      stream: options?.stream ?? false,
    });
  }

  async resume(runId: string, options?: { stream?: boolean }): Promise<RunState> {
    const projectConfig = this.deps.configLoader.loadProjectConfig();
    const state = this.deps.stateManager.findRunById(runId);
    const agents = this.deps.configLoader.loadAgents();
    const workflow = this.deps.configLoader.loadWorkflow(state.workflowId);
    this.deps.configLoader.validateReferences(agents, workflow);
    const plan = this.dagParser.parse(workflow.steps);
    return this.executeWorkflow({
      projectConfig,
      agents,
      workflow,
      state,
      plan,
      isResume: true,
      stream: options?.stream ?? false,
    });
  }

  private async executeWorkflow(params: {
    projectConfig: ProjectConfig;
    agents: Map<string, AgentConfig>;
    workflow: WorkflowConfig;
    state: RunState;
    plan: ReturnType<DAGParser['parse']>;
    isResume: boolean;
    stream: boolean;
  }): Promise<RunState> {
    const { projectConfig, agents, workflow, state, plan, isResume, stream } = params;
    const runDir = this.deps.stateManager.getRunDir(workflow.workflow.id, state.runId);
    this.deps.outputWriter.ensureDir(runDir);
    const logger = new EventLogger(path.join(runDir, 'events.jsonl'));

    if (isResume) {
      for (const stepId of plan.order) {
        const current = state.steps[stepId];
        if (current && (current.status === 'running' || current.status === 'interrupted')) {
          this.deps.stateManager.updateStep(state, stepId, {
            status: 'pending',
            error: undefined,
            startedAt: undefined,
            completedAt: undefined,
          });
        }
      }
    }
    this.deps.stateManager.updateRun(state, {
      status: 'running',
      completedAt: undefined,
    });
    this.deps.eventHandler.onWorkflowStart(workflow.workflow.name, plan, state);
    logger.log('workflow.started', {
      workflowId: workflow.workflow.id,
      runId: state.runId,
      resumed: isResume,
      input: state.input,
    });

    const onSigint = (): void => {
      this.interrupted = true;
      const runningIds = Object.entries(state.steps)
        .filter(([, value]) => value.status === 'running')
        .map(([stepId]) => stepId);
      for (const stepId of runningIds) {
        this.deps.stateManager.updateStep(state, stepId, {
          status: 'interrupted',
          completedAt: Date.now(),
        });
      }
      this.deps.stateManager.updateRun(state, {
        status: 'interrupted',
        completedAt: Date.now(),
      });
      logger.log('workflow.interrupted', { runId: state.runId, workflowId: state.workflowId });
      this.deps.eventHandler.onWorkflowInterrupted(state);
    };
    process.on('SIGINT', onSigint);

    // Load skills for template rendering
    let skillsContext: Record<string, { instructions: string; output_format?: string }> = {};
    try {
      const skillsRegistry = this.deps.configLoader.createSkillsRegistry();
      skillsContext = buildSkillsContext(skillsRegistry.getAll()).skills;
    } catch {
      // Skills directory may not exist, continue without skills
    }

    try {
      const stepById = new Map(workflow.steps.map((step) => [step.id, step]));
      const scheduler = new Scheduler(plan, state, async (stepId: string) => {
        const step = stepById.get(stepId);
        if (!step) {
          throw new Error(`Step "${stepId}" not found in workflow`);
        }
        await this.executeStepWithRetry({
          projectConfig,
          agents,
          workflow,
          step,
          state,
          runDir,
          logger,
          stream,
          skillsContext,
        });
      });

      await scheduler.run();
      if (this.interrupted) {
        throw new WorkflowInterruptError();
      }
      this.deps.stateManager.updateRun(state, { status: 'completed', completedAt: Date.now() });
      logger.log('workflow.completed', { runId: state.runId, workflowId: state.workflowId });
      this.deps.eventHandler.onWorkflowComplete(state);
      await this.writeRunMetadata({ state, workflow, agents, projectConfig });
      return state;
    } catch (error) {
      if (error instanceof GateRejectError || error instanceof WorkflowInterruptError) {
        this.deps.stateManager.updateRun(state, { status: 'interrupted', completedAt: Date.now() });
        logger.log('workflow.interrupted', {
          runId: state.runId,
          workflowId: state.workflowId,
          reason: error instanceof GateRejectError ? 'gate' : 'signal',
        });
        if (!(error instanceof WorkflowInterruptError)) {
          this.deps.eventHandler.onWorkflowInterrupted(state);
        }
        await this.writeRunMetadata({ state, workflow, agents, projectConfig });
        return state;
      }

      const message = error instanceof Error ? error.message : 'workflow execution failed';
      this.deps.stateManager.updateRun(state, {
        status: 'failed',
        completedAt: Date.now(),
      });
      logger.log('workflow.failed', {
        runId: state.runId,
        workflowId: state.workflowId,
        error: message,
        ...getRuntimeErrorMeta(error),
      });
      this.deps.eventHandler.onWorkflowFailed(state, error instanceof Error ? error : new Error(String(error)));
      await this.writeRunMetadata({ state, workflow, agents, projectConfig });
      throw error;
    } finally {
      this.interrupted = false;
      process.off('SIGINT', onSigint);
    }
  }

  private async executeStepWithRetry(params: {
    projectConfig: ProjectConfig;
    agents: Map<string, AgentConfig>;
    workflow: WorkflowConfig;
    step: StepConfig;
    state: RunState;
    runDir: string;
    logger: EventLogger;
    stream: boolean;
    skillsContext: Record<string, { instructions: string; output_format?: string }>;
  }): Promise<void> {
    const { projectConfig, step, logger, state, workflow } = params;
    const retryConfig = step.retry ?? projectConfig.retry;
    const maxAttempts = Math.max(0, retryConfig.max_attempts);
    const delayMs = Math.max(0, retryConfig.delay_seconds) * 1000;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.executeStepCore({
          ...params,
          skillsContext: params.skillsContext,
        });
        return;
      } catch (error) {
        if (error instanceof GateRejectError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : 'unknown runtime error';
        if (attempt < maxAttempts) {
          const retryCount = attempt + 1;
          this.deps.stateManager.updateStep(state, step.id, {
            retryCount,
            error: message,
            status: 'pending',
            startedAt: undefined,
            completedAt: undefined,
          });
          logger.log('step.retrying', {
            stepId: step.id,
            attempt: retryCount,
            maxAttempts,
            delaySeconds: retryConfig.delay_seconds,
            error: message,
            ...getRuntimeErrorMeta(error),
          });
          this.deps.eventHandler.onStepRetry(step.id, retryCount, maxAttempts, message);
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // All retries exhausted - handle based on on_failure strategy
        const onFailure = step.on_failure ?? 'fail';

        switch (onFailure) {
          case 'skip':
            // Mark as skipped and continue
            this.deps.stateManager.updateStep(state, step.id, {
              status: 'skipped',
              completedAt: Date.now(),
              error: message,
            });
            logger.log('step.skipped', {
              stepId: step.id,
              error: message,
              reason: 'on_failure=skip',
            });
            this.deps.eventHandler.onStepSkipped(step.id, message);
            return; // Don't throw, allow workflow to continue

          case 'fallback':
            // Execute with fallback agent
            logger.log('step.retrying', {
              stepId: step.id,
              attempt: 'fallback',
              fallbackAgent: step.fallback_agent,
              error: message,
            });
            try {
              await this.executeStepCore({
                ...params,
                step: {
                  ...step,
                  agent: step.fallback_agent!,
                  id: step.id, // Keep original step ID
                },
              });
              return;
            } catch (fallbackError) {
              // Fallback also failed, mark as failed
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : 'fallback failed';
              this.deps.stateManager.updateStep(state, step.id, {
                status: 'failed',
                completedAt: Date.now(),
                error: `Primary: ${message}; Fallback: ${fallbackMessage}`,
              });
              logger.log('step.failed', {
                stepId: step.id,
                error: `Primary: ${message}; Fallback: ${fallbackMessage}`,
                ...getRuntimeErrorMeta(fallbackError),
              });
              this.deps.eventHandler.onStepFailed(step.id, fallbackMessage);
              throw fallbackError;
            }

          case 'notify':
            if (step.notify?.webhook) {
              await sendWebhookNotification(step.notify.webhook, {
                workflowId: workflow.workflow.id,
                runId: state.runId,
                stepId: step.id,
                agent: step.agent,
                error: message,
                timestamp: Date.now(),
              });
            }
            this.deps.stateManager.updateStep(state, step.id, {
              status: 'failed',
              completedAt: Date.now(),
              error: message,
            });
            logger.log('step.failed', {
              stepId: step.id,
              error: message,
              reason: 'on_failure=notify',
              ...getRuntimeErrorMeta(error),
            });
            this.deps.eventHandler.onStepFailed(step.id, message);
            throw error;

          case 'fail':
          default:
            // Send webhook notification if configured
            if (step.notify?.webhook) {
              await sendWebhookNotification(step.notify.webhook, {
                workflowId: workflow.workflow.id,
                runId: state.runId,
                stepId: step.id,
                agent: step.agent,
                error: message,
                timestamp: Date.now(),
              });
            }

            // Mark as failed and throw
            this.deps.stateManager.updateStep(state, step.id, {
              status: 'failed',
              completedAt: Date.now(),
              error: message,
            });
            logger.log('step.failed', {
              stepId: step.id,
              error: message,
              ...getRuntimeErrorMeta(error),
            });
            this.deps.eventHandler.onStepFailed(step.id, message);
            throw error;
        }
      }
    }
  }

  private async executeStepCore(params: {
    projectConfig: ProjectConfig;
    agents: Map<string, AgentConfig>;
    workflow: WorkflowConfig;
    step: StepConfig;
    state: RunState;
    runDir: string;
    logger: EventLogger;
    stream: boolean;
    skillsContext: Record<string, { instructions: string; output_format?: string }>;
  }): Promise<void> {
    const { projectConfig, agents, workflow, step, state, runDir, logger, stream, skillsContext } = params;
    if (this.interrupted) {
      throw new WorkflowInterruptError();
    }
    const startedAt = Date.now();
    this.deps.stateManager.updateStep(state, step.id, {
      status: 'running',
      startedAt,
    });
    this.deps.eventHandler.onStepStart(step.id);
    logger.log('step.started', { stepId: step.id, agent: step.agent });

    const agent = agents.get(step.agent);
    if (!agent) {
      throw new Error(`Agent "${step.agent}" not found`);
    }

    // Process context if configured
    const processedContexts: Record<string, string> = {};
    const templateContextBase = {
      input: state.input,
      inputs: state.inputData,
      workflowId: workflow.workflow.id,
      runId: state.runId,
      runDir,
      steps: Object.fromEntries(
        Object.entries(state.steps).map(([stepId, stepState]) => [stepId, { outputFile: stepState.outputFile }]),
      ),
      processedContexts,
      skills: skillsContext,
    } satisfies RenderContext;
    let systemPrompt = renderTemplate(agent.prompt.system, templateContextBase);

    if (step.context) {
      const { from, strategy, max_tokens, inject_as } = step.context;
      const sourceStep = state.steps[from];
      if (!sourceStep?.outputFile) {
        throw new Error(`Context step "${from}" has no output`);
      }
      const sourceOutputPath = path.join(runDir, sourceStep.outputFile);
      const rawContent = fs.readFileSync(sourceOutputPath, 'utf8');

      const processedContent = await processContext({
        rawContent,
        strategy,
        maxTokens: max_tokens,
        autoThresholds: projectConfig.context
          ? {
              rawLimit: projectConfig.context.auto_raw_threshold ?? 500,
              truncateLimit: projectConfig.context.auto_truncate_threshold ?? 2000,
            }
          : undefined,
        summarizeRuntime: this.deps.runtimeFactory(agent.runtime.type, projectConfig, agent),
        summarizeModel: projectConfig.context?.summary_model || agent.runtime.model || projectConfig.runtime.default_model,
      });

      processedContexts[from] = processedContent;

      if (inject_as === 'system') {
        systemPrompt = `${systemPrompt}\n\n${processedContent}`;
      }
    }

    let renderedPrompt = renderTemplate(step.task, templateContextBase);
    if (step.context?.inject_as === 'user') {
      renderedPrompt = `${processedContexts[step.context.from]}\n\n${renderedPrompt}`;
    }

    // Resolve custom filename if configured
    let customFilename: string | undefined;
    if (workflow.output.files) {
      const fileConfig = workflow.output.files.find((f) => f.step === step.id);
      if (fileConfig) {
        customFilename = renderTemplate(fileConfig.filename, templateContextBase);
      }
    }

    const runtime = this.deps.runtimeFactory(agent.runtime.type, projectConfig, agent);
    const model = agent.runtime.model || projectConfig.runtime.default_model;
    const timeoutSeconds = agent.runtime.timeout_seconds || 300;
    const postProcessorSalt = step.post_processors?.length ? `\n__post_processors__:${JSON.stringify(step.post_processors)}` : '';
    const cachePrompt = `${renderedPrompt}${postProcessorSalt}`;

    // Determine cache settings (step-level overrides workflow-level)
    const cacheConfig = step.cache ?? workflow.cache;
    const cacheEnabled = cacheConfig?.enabled ?? false;
    const cacheTtl = cacheConfig?.ttl ?? 3600;

    // Check cache if enabled
    if (cacheEnabled && this.deps.cache) {
      const cacheKey = this.deps.cache.computeKey(step.id, step.agent, cachePrompt, model);
      const cached = this.deps.cache.get(cacheKey);

      if (cached) {
        // Use cached result
        const outputFile = this.deps.outputWriter.writeStepOutput(runDir, step.id, cached.output, customFilename);
        const outputFileName = path.basename(outputFile);
        const durationMs = Date.now() - startedAt;

        this.deps.stateManager.updateStep(state, step.id, {
          status: 'completed',
          completedAt: Date.now(),
          outputFile: outputFileName,
          tokenUsage: cached.tokenUsage,
          durationMs,
        });

        logger.log('step.cached', {
          stepId: step.id,
          cached: true,
          outputFile: outputFileName,
        });

        const previewLines = projectConfig.output.preview_lines;
        this.deps.eventHandler.onStepComplete(step.id, {
          duration: durationMs,
          outputPreview: cached.output.split('\n').slice(0, previewLines).join('\n'),
          tokenUsage: cached.tokenUsage,
        });

        return;
      }
    }

    try {
      let result;
      if (stream && runtime.executeStream) {
        result = await runtime.executeStream(
          {
            systemPrompt,
            userPrompt: renderedPrompt,
            model,
            timeoutSeconds,
          },
          (chunk) => {
            this.deps.eventHandler.onStreamChunk?.(step.id, chunk);
          },
        );
      } else {
        result = await runtime.execute({
          systemPrompt,
          userPrompt: renderedPrompt,
          model,
          timeoutSeconds,
        });
      }
      const finalOutput = await this.applyPostProcessors(result.output, step, state, workflow);

      // Store in cache if enabled
      if (cacheEnabled && this.deps.cache) {
        const cacheKey = this.deps.cache.computeKey(step.id, step.agent, cachePrompt, model);
        this.deps.cache.set(cacheKey, {
          output: finalOutput,
          tokenUsage: result.tokenUsage,
          durationMs: result.duration,
        }, cacheTtl);
      }

      const outputFile = this.deps.outputWriter.writeStepOutput(runDir, step.id, finalOutput, customFilename);
      const outputFileName = path.basename(outputFile);
      const durationMs = Date.now() - startedAt;
      this.deps.stateManager.updateStep(state, step.id, {
        status: 'completed',
        completedAt: Date.now(),
        outputFile: outputFileName,
        tokenUsage: result.tokenUsage,
        durationMs,
      });
      logger.log('step.completed', {
        stepId: step.id,
        duration: result.duration,
        outputFile: outputFileName,
        tokenUsage: result.tokenUsage,
      });
      const previewLines = projectConfig.output.preview_lines;
      this.deps.eventHandler.onStepComplete(step.id, {
        duration: durationMs,
        outputPreview: finalOutput.split('\n').slice(0, previewLines).join('\n'),
        tokenUsage: result.tokenUsage,
      });

      if (step.gate === 'approve') {
        this.deps.stateManager.updateStep(state, step.id, {
          status: 'gate_waiting',
        });
        logger.log('gate.waiting', { stepId: step.id, gateType: 'approve' });
        this.deps.eventHandler.onGateWaiting(step.id, finalOutput, previewLines);
        const decision = await this.deps.gateManager.handleGate(step.id, 'approve', finalOutput, {
          runId: state.runId,
        });
        logger.log('gate.resolved', {
          stepId: step.id,
          action: decision.action,
        });
        if (decision.action === 'abort') {
          this.deps.stateManager.updateStep(state, step.id, {
            status: 'interrupted',
            completedAt: Date.now(),
          });
          logger.log('gate.rejected', { stepId: step.id });
          throw new GateRejectError(step.id);
        }
        if (decision.action === 'edit') {
          this.deps.outputWriter.writeStepOutput(runDir, step.id, decision.editedOutput, customFilename);
          this.deps.stateManager.updateStep(state, step.id, {
            status: 'completed',
          });
          logger.log('gate.edited', { stepId: step.id });
        } else {
          this.deps.stateManager.updateStep(state, step.id, {
            status: 'completed',
          });
          logger.log('gate.approved', { stepId: step.id });
        }
      }
    } catch (error) {
      if (error instanceof GateRejectError) {
        throw error;
      }
      if (error instanceof RuntimeError) {
        throw new RuntimeError(error.message, step.id, error.details);
      }
      const message = error instanceof Error ? error.message : 'unknown runtime error';
      throw new RuntimeError(message, step.id);
    }
  }

  private hydrateRecoveredSteps(params: {
    workflowId: string;
    sourceRunId: string;
    targetState: RunState;
    reusedStepIds: string[];
  }): void {
    const { workflowId, sourceRunId, targetState, reusedStepIds } = params;
    const sourceRun = this.deps.stateManager.findRunById(sourceRunId);
    const sourceRunDir = this.deps.stateManager.getRunDir(sourceRun.workflowId, sourceRun.runId);
    const targetRunDir = this.deps.stateManager.getRunDir(workflowId, targetState.runId);

    for (const stepId of reusedStepIds) {
      const sourceStep = sourceRun.steps[stepId];
      if (!sourceStep || sourceStep.status !== 'completed' || !sourceStep.outputFile) {
        continue;
      }

      const sourceOutputPath = path.join(sourceRunDir, sourceStep.outputFile);
      const targetOutputPath = path.join(targetRunDir, sourceStep.outputFile);
      if (!fs.existsSync(sourceOutputPath)) {
        continue;
      }

      fs.mkdirSync(path.dirname(targetOutputPath), { recursive: true });
      fs.copyFileSync(sourceOutputPath, targetOutputPath);

      this.deps.stateManager.updateStep(targetState, stepId, {
        status: 'completed',
        startedAt: targetState.startedAt,
        completedAt: targetState.startedAt,
        outputFile: sourceStep.outputFile,
        error: undefined,
        retryCount: undefined,
        tokenUsage: undefined,
        durationMs: undefined,
      });
    }
  }

  private buildWorkflowSnapshot(
    workflow: WorkflowConfig,
    agents: Map<string, AgentConfig>,
  ): WorkflowSnapshot {
    const stepSnapshots: Record<string, StepSnapshot> = {};
    for (const step of workflow.steps) {
      const agent = agents.get(step.agent);
      stepSnapshots[step.id] = {
        id: step.id,
        agent: {
          id: step.agent,
          name: agent?.agent.name ?? step.agent,
          model: agent?.runtime.model,
          runtimeType: agent?.runtime.type ?? 'llm-direct',
        },
        systemPrompt: agent?.prompt.system ?? '',
        task: step.task,
        dependsOn: step.depends_on ?? [],
        gate: step.gate ?? 'auto',
      };
    }

    const versionHash = createHash('sha256').update(JSON.stringify({
      workflowId: workflow.workflow.id,
      steps: Object.values(stepSnapshots).sort((a, b) => a.id.localeCompare(b.id)),
    })).digest('hex').slice(0, 16);

    return {
      workflowId: workflow.workflow.id,
      versionHash,
      steps: stepSnapshots,
      capturedAt: Date.now(),
    };
  }

  private async applyPostProcessors(
    output: string,
    step: StepConfig,
    state: RunState,
    workflow: WorkflowConfig,
  ): Promise<string> {
    if (!step.post_processors?.length) {
      return output;
    }

    const originalOutput = output;
    let currentOutput = output;
    const projectRoot = this.deps.configLoader.getProjectRoot();

    for (const [index, processor] of step.post_processors.entries()) {
      try {
        currentOutput = await runScriptPostProcessor(currentOutput, processor, index, {
          cwd: projectRoot,
          runId: state.runId,
          workflowId: workflow.workflow.id,
          stepId: step.id,
        });
      } catch (error) {
        const mode = processor.on_error ?? 'fail';
        const message = error instanceof Error ? error.message : 'post-processor failed';
        if (mode === 'skip') {
          continue;
        }
        if (mode === 'passthrough') {
          return originalOutput;
        }
        throw new RuntimeError(message, step.id);
      }
    }

    return currentOutput;
  }

  private async writeRunMetadata(params: {
    state: RunState;
    workflow: WorkflowConfig;
    agents: Map<string, AgentConfig>;
    projectConfig: ProjectConfig;
    evalResult?: { score: number; tokenCost: number };
  }): Promise<void> {
    const { state, workflow, agents, evalResult } = params;

    // Calculate total token cost from all steps
    let totalTokenCost = 0;
    for (const stepState of Object.values(state.steps)) {
      if (stepState.tokenUsage) {
        totalTokenCost += stepState.tokenUsage.totalTokens;
      }
    }
    if (evalResult?.tokenCost) {
      totalTokenCost += evalResult.tokenCost;
    }

    // Collect agents and models used
    const agentIds: string[] = [];
    const models: string[] = [];
    for (const step of workflow.steps) {
      if (!agentIds.includes(step.agent)) {
        agentIds.push(step.agent);
        const agentConfig = agents.get(step.agent);
        models.push(agentConfig?.runtime.model || params.projectConfig.runtime.default_model);
      }
    }

    const metadata = {
      runId: state.runId,
      workflowId: state.workflowId,
      agents: agentIds,
      models,
      score: evalResult?.score,
      tokenCost: totalTokenCost,
      duration: (state.completedAt ?? Date.now()) - state.startedAt,
      createdAt: new Date(state.startedAt).toISOString(),
    };

    // Write to metadata.jsonl
    const outputDir = this.deps.stateManager.getOutputDir();
    const metadataDir = path.join(outputDir, '.runs');
    const metadataPath = path.join(metadataDir, 'metadata.jsonl');

    try {
      fs.mkdirSync(metadataDir, { recursive: true });
      const line = JSON.stringify(metadata) + '\n';
      fs.appendFileSync(metadataPath, line);
    } catch (error) {
      // Don't fail the workflow if metadata writing fails
      console.warn('Failed to write run metadata:', error instanceof Error ? error.message : error);
    }
  }
}
