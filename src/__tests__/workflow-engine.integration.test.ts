import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../output/notifier.js', () => ({
  sendWebhookNotification: vi.fn(async () => {}),
}));

import { ConfigLoader } from '../config/loader.js';
import { RuntimeError } from '../errors.js';
import { GateManager } from '../engine/gate.js';
import { StateManager } from '../engine/state.js';
import { WorkflowEngine } from '../engine/workflow-engine.js';
import { sendWebhookNotification } from '../output/notifier.js';
import { OutputWriter } from '../output/writer.js';
import type { AgentConfig, AgentRuntime, ExecuteResult, ProjectConfig, RuntimeType } from '../types/index.js';

const tempRoots: string[] = [];

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function createTempProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagents-engine-it-'));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, 'agents'));
  fs.mkdirSync(path.join(root, 'skills'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'workflows'));
  write(
    path.join(root, 'openagents.yaml'),
    `version: "1"
runtime:
  default_type: llm-direct
  default_model: qwen-plus
retry:
  max_attempts: 0
  delay_seconds: 0
output:
  base_directory: ./output
  preview_lines: 5
`,
  );
  return root;
}

function createEngine(
  root: string,
  runtimeFactory: (type: RuntimeType, projectConfig: ProjectConfig, agentConfig?: AgentConfig) => AgentRuntime,
): { engine: WorkflowEngine; stateManager: StateManager } {
  const loader = new ConfigLoader(root);
  const projectConfig = loader.loadProjectConfig();
  const outputBaseDir = path.resolve(root, projectConfig.output.base_directory);
  const stateManager = new StateManager(outputBaseDir);
  const outputWriter = new OutputWriter();
  const gateManager = new GateManager('en', { autoApprove: true });
  const eventHandler = {
    onWorkflowStart: () => {},
    onWorkflowComplete: () => {},
    onWorkflowFailed: () => {},
    onWorkflowInterrupted: () => {},
    onStepStart: () => {},
    onStepComplete: () => {},
    onStepFailed: () => {},
    onStepSkipped: () => {},
    onStepRetry: () => {},
    onStreamChunk: () => {},
    onGateWaiting: () => {},
  };
  const engine = new WorkflowEngine({
    configLoader: loader,
    stateManager,
    runtimeFactory,
    outputWriter,
    gateManager,
    eventHandler: eventHandler as never,
  });
  return { engine, stateManager };
}

afterEach(() => {
  vi.clearAllMocks();
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.length = 0;
});

describe('WorkflowEngine integration', () => {
  it('reuses completed recovery steps instead of executing them again', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/worker.yaml'),
      `agent:
  id: worker
  name: Worker
  description: reusable worker
prompt:
  system: run
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/recovery-demo.yaml'),
      `workflow:
  id: recovery-demo
  name: Recovery Demo
  description: recovery execution test
steps:
  - id: step1
    agent: worker
    task: first
  - id: step2
    agent: worker
    depends_on: [step1]
    task: second
output:
  directory: ./output
`,
    );

    const calls: string[] = [];
    let shouldFailStep2 = true;
    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async ({ userPrompt }): Promise<ExecuteResult> => {
        calls.push(userPrompt);
        if (userPrompt === 'second' && shouldFailStep2) {
          shouldFailStep2 = false;
          throw new Error('step2 failed');
        }
        return { output: `${agentConfig?.agent.id}:${userPrompt}`, duration: 1 };
      },
    });
    const { engine, stateManager } = createEngine(root, runtimeFactory);

    await expect(engine.run('recovery-demo', 'input')).rejects.toThrow('step2 failed');
    const failedRun = stateManager.listRuns({ workflowId: 'recovery-demo' }).find((run) => run.status === 'failed');
    expect(failedRun).toBeDefined();
    expect(failedRun!.steps.step1.outputFile).toBeDefined();

    calls.length = 0;

    const recovered = await engine.run('recovery-demo', 'input', {
      runId: 'recovery_run',
      sourceRunId: failedRun!.runId,
      recoveryInfo: {
        reusedStepIds: ['step1'],
        rerunStepIds: ['step2'],
      },
    });

    expect(recovered.status).toBe('completed');
    expect(calls).toEqual(['second']);
    expect(recovered.steps.step1.status).toBe('completed');
    expect(recovered.steps.step1.outputFile).toBe(failedRun!.steps.step1.outputFile);
  });

  it('renders skills in system prompt and injects processed context into user prompt', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/researcher.yaml'),
      `agent:
  id: researcher
  name: Researcher
  description: creates research
prompt:
  system: collect facts
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: writes with skill
prompt:
  system: |
    role: writer
    {{skills.style_guide.instructions}}
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'skills/style_guide.yaml'),
      `skill:
  id: style_guide
  name: Style Guide
  description: style guidance
  version: 1.0

instructions: Write in a crisp tone.
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test skill render and user injection
steps:
  - id: research
    agent: researcher
    task: gather notes
  - id: write
    agent: writer
    depends_on: [research]
    context:
      from: research
      strategy: raw
      inject_as: user
    task: Draft article
output:
  directory: ./output
`,
    );

    const calls: Array<{ agentId: string | undefined; systemPrompt: string; userPrompt: string }> = [];
    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async (params): Promise<ExecuteResult> => {
        calls.push({
          agentId: agentConfig?.agent.id,
          systemPrompt: params.systemPrompt,
          userPrompt: params.userPrompt,
        });
        if (agentConfig?.agent.id === 'researcher') {
          return { output: 'research summary', duration: 1 };
        }
        return { output: 'drafted', duration: 1 };
      },
    });
    const { engine } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');

    const writerCall = calls.find((call) => call.agentId === 'writer');
    expect(writerCall?.systemPrompt).toContain('Write in a crisp tone.');
    expect(writerCall?.userPrompt).toBe('research summary\n\nDraft article');
  });

  it('supports auto context strategy falling back to summarize for large content', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/researcher.yaml'),
      `agent:
  id: researcher
  name: Researcher
  description: creates research
prompt:
  system: collect facts
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: writes
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test auto summarize
steps:
  - id: research
    agent: researcher
    task: gather notes
  - id: write
    agent: writer
    depends_on: [research]
    context:
      from: research
      strategy: auto
      max_tokens: 100
    task: "{{context.research}}"
output:
  directory: ./output
`,
    );

    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async (params): Promise<ExecuteResult> => {
        if (agentConfig?.agent.id === 'researcher') {
          return { output: 'a'.repeat(9000), duration: 1 };
        }
        if (params.systemPrompt.includes('text summarization assistant')) {
          return { output: 'summarized context', duration: 1 };
        }
        expect(params.userPrompt).toContain('summarized context');
        return { output: 'done', duration: 1 };
      },
    });
    const { engine } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.write.status).toBe('completed');
  });

  it('marks the run interrupted on SIGINT without exiting the process', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: succeeds
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test interrupt
steps:
  - id: write
    agent: writer
    task: produce content
output:
  directory: ./output
`,
    );

    const runtimeFactory = (): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { output: 'late output', duration: 30 };
      },
    });
    const { engine } = createEngine(root, runtimeFactory);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const runPromise = engine.run('demo', 'input');
    setTimeout(() => {
      process.emit('SIGINT');
    }, 5);

    const state = await runPromise;
    expect(state.status).toBe('interrupted');
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('continues downstream execution when dependency is skipped', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/failer.yaml'),
      `agent:
  id: failer
  name: Failer
  description: always fails
prompt:
  system: fail
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: succeeds
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test skip
steps:
  - id: precheck
    agent: failer
    task: fail here
    on_failure: skip
  - id: main
    agent: writer
    depends_on: [precheck]
    task: continue
output:
  directory: ./output
`,
    );

    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => {
        if (agentConfig?.agent.id === 'failer') {
          throw new RuntimeError('expected failure', 'precheck');
        }
        return { output: 'ok', duration: 1 };
      },
    });
    const { engine } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.precheck.status).toBe('skipped');
    expect(state.steps.main.status).toBe('completed');
  });

  it('uses fallback agent when primary agent fails', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/primary.yaml'),
      `agent:
  id: primary
  name: Primary
  description: always fails
prompt:
  system: primary
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'agents/backup.yaml'),
      `agent:
  id: backup
  name: Backup
  description: succeeds
prompt:
  system: backup
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test fallback
steps:
  - id: write
    agent: primary
    task: produce content
    on_failure: fallback
    fallback_agent: backup
output:
  directory: ./output
`,
    );

    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => {
        if (agentConfig?.agent.id === 'primary') {
          throw new RuntimeError('primary failed', 'write');
        }
        return { output: 'from-backup', duration: 1 };
      },
    });
    const { engine } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.write.status).toBe('completed');
  });

  it('triggers webhook and fails run when on_failure=notify', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/failer.yaml'),
      `agent:
  id: failer
  name: Failer
  description: always fails
prompt:
  system: fail
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: should not execute
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test notify
steps:
  - id: precheck
    agent: failer
    task: fail here
    on_failure: notify
    notify:
      webhook: https://example.com/hook
  - id: main
    agent: writer
    depends_on: [precheck]
    task: should not run
output:
  directory: ./output
`,
    );

    const runtimeFactory = (_type: RuntimeType, _projectConfig: ProjectConfig, agentConfig?: AgentConfig): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => {
        if (agentConfig?.agent.id === 'failer') {
          throw new RuntimeError('notify failure', 'precheck');
        }
        return { output: 'unexpected', duration: 1 };
      },
    });
    const { engine, stateManager } = createEngine(root, runtimeFactory);

    await expect(engine.run('demo', 'input')).rejects.toThrow('notify failure');
    expect(sendWebhookNotification).toHaveBeenCalledTimes(1);

    const [run] = stateManager.listRuns({ workflowId: 'demo' });
    expect(run.status).toBe('failed');
    expect(run.steps.precheck.status).toBe('failed');
    expect(run.steps.main.status).toBe('pending');
  });

  it('applies script post_processor output before writing step file', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: succeeds
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'scripts/shrink.mjs'),
      `import { stdin, stdout } from 'node:process';
let data = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => { data += chunk; });
stdin.on('end', () => {
  stdout.write(data.slice(0, 4));
});
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test post processors
steps:
  - id: write
    agent: writer
    task: produce content
    post_processors:
      - type: script
        command: node scripts/shrink.mjs
output:
  directory: ./output
`,
    );

    const runtimeFactory = (): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => ({ output: 'abcdefghij', duration: 1 }),
    });
    const { engine, stateManager } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.write.status).toBe('completed');

    const [run] = stateManager.listRuns({ workflowId: 'demo' });
    const outputPath = path.join(stateManager.getRunDir('demo', run.runId), run.steps.write.outputFile!);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('abcd');
  });

  it('keeps original output when post_processor fails with on_error=skip', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: succeeds
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'scripts/fail.mjs'),
      `process.exit(1);
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test post processors
steps:
  - id: write
    agent: writer
    task: produce content
    post_processors:
      - type: script
        command: node scripts/fail.mjs
        on_error: skip
output:
  directory: ./output
`,
    );

    const runtimeFactory = (): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => ({ output: 'original-output', duration: 1 }),
    });
    const { engine, stateManager } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.write.status).toBe('completed');

    const [run] = stateManager.listRuns({ workflowId: 'demo' });
    const outputPath = path.join(stateManager.getRunDir('demo', run.runId), run.steps.write.outputFile!);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('original-output');
  });

  it('passthrough returns original output and stops processor chain', async () => {
    const root = createTempProject();
    write(
      path.join(root, 'agents/writer.yaml'),
      `agent:
  id: writer
  name: Writer
  description: succeeds
prompt:
  system: write
runtime:
  type: llm-direct
  model: qwen-plus
  timeout_seconds: 5
`,
    );
    write(
      path.join(root, 'scripts/fail.mjs'),
      `process.exit(1);
`,
    );
    write(
      path.join(root, 'scripts/append.mjs'),
      `import { stdin, stdout } from 'node:process';
let data = '';
stdin.setEncoding('utf8');
stdin.on('data', (chunk) => { data += chunk; });
stdin.on('end', () => {
  stdout.write(data + '-changed');
});
`,
    );
    write(
      path.join(root, 'workflows/demo.yaml'),
      `workflow:
  id: demo
  name: Demo
  description: test post processors
steps:
  - id: write
    agent: writer
    task: produce content
    post_processors:
      - type: script
        command: node scripts/fail.mjs
        on_error: passthrough
      - type: script
        command: node scripts/append.mjs
output:
  directory: ./output
`,
    );

    const runtimeFactory = (): AgentRuntime => ({
      execute: async (): Promise<ExecuteResult> => ({ output: 'original', duration: 1 }),
    });
    const { engine, stateManager } = createEngine(root, runtimeFactory);

    const state = await engine.run('demo', 'input');
    expect(state.status).toBe('completed');
    expect(state.steps.write.status).toBe('completed');

    const [run] = stateManager.listRuns({ workflowId: 'demo' });
    const outputPath = path.join(stateManager.getRunDir('demo', run.runId), run.steps.write.outputFile!);
    expect(fs.readFileSync(outputPath, 'utf8')).toBe('original');
  });
});
