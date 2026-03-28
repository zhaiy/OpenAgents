import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreflightService } from '../app/services/preflight-service.js';
import { createDoctorCommand, createPreflightCommand } from '../cli/doctor.js';
import { createEventsCommand } from '../cli/events.js';
import { createSkillsCommand } from '../cli/skills.js';
import { StateManager } from '../engine/state.js';
import { EventLogger } from '../output/logger.js';

function writeProjectConfig(root: string): void {
  fs.writeFileSync(
    path.join(root, 'openagents.yaml'),
    `version: "1"
runtime:
  default_type: llm-direct
  default_model: gpt-test
retry:
  max_attempts: 2
  delay_seconds: 5
output:
  base_directory: ./output
  preview_lines: 10
`,
    'utf8',
  );
}

function writeMinimalWorkflow(root: string): void {
  fs.mkdirSync(path.join(root, 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'workflows', 'demo.yaml'),
    `workflow:
  id: demo
  name: Demo
  description: Demo workflow
steps:
  - id: draft
    agent: writer
    task: write
output:
  directory: ./output/demo
`,
    'utf8',
  );
}

function writeMinimalAgent(root: string): void {
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'agents', 'writer.yaml'),
    `agent:
  id: writer
  name: Writer
  description: Writes
prompt:
  system: You are a writer.
runtime:
  type: llm-direct
  model: gpt-test
  timeout_seconds: 30
`,
    'utf8',
  );
}

async function parseCommand(command: Command, argv: string[]): Promise<void> {
  await command.parseAsync(['node', 'test', ...argv], { from: 'node' });
}

describe('new CLI commands', () => {
  let root: string;
  let previousCwd: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagents-cli-'));
    previousCwd = process.cwd();
    process.chdir(root);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('doctor outputs JSON diagnostics', async () => {
    writeProjectConfig(root);
    writeMinimalAgent(root);
    writeMinimalWorkflow(root);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = new Command().addCommand(createDoctorCommand());

    await parseCommand(command, ['doctor', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.status).toBe('warning');
    expect(fs.realpathSync(parsed.projectRoot)).toBe(fs.realpathSync(root));
    expect(parsed.summary.total).toBeGreaterThan(0);
  });

  it('preflight alias returns the same structured result as the service', async () => {
    writeProjectConfig(root);
    writeMinimalAgent(root);
    writeMinimalWorkflow(root);

    const expected = new PreflightService(root).runDiagnostics();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = new Command().addCommand(createPreflightCommand());

    await parseCommand(command, ['preflight', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed.status).toBe(expected.status);
    expect(parsed.summary).toEqual(expected.summary);
  });

  it('skills list only returns schema-valid skills in JSON mode', async () => {
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'skills', 'valid.yaml'),
      `skill:
  id: valid_skill
  name: Valid Skill
  description: A valid skill
  version: 1.0
instructions: Follow the instructions.
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'skills', 'invalid.yaml'),
      `skill:
  id: invalid_skill
  name: Invalid Skill
  description: Missing instructions
  version: 1.0
`,
      'utf8',
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const command = new Command().addCommand(createSkillsCommand());

    await parseCommand(command, ['skills', '--json']);

    const parsed = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].skill.id).toBe('valid_skill');
  });

  it('events stream reads run state from configured output directory', async () => {
    writeProjectConfig(root);
    const outputDir = path.join(root, 'output');
    const stateManager = new StateManager(outputDir);
    const state = stateManager.initRun('run_demo', 'demo', 'input', ['draft']);
    stateManager.updateRun(state, { status: 'completed', completedAt: Date.now() });

    const logger = new EventLogger(path.join(outputDir, 'demo', 'run_demo', 'events.jsonl'));
    logger.log('workflow.started', { runId: 'run_demo', workflowId: 'demo' });
    logger.log('step.started', { runId: 'run_demo', workflowId: 'demo', stepId: 'draft' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = new Command().addCommand(createEventsCommand());

    await parseCommand(command, ['events', 'stream', '--run', 'run_demo', '--json', '--no-follow']);

    const first = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    const second = JSON.parse(logSpy.mock.calls[1]?.[0] as string);
    expect(first.workflowId).toBe('demo');
    expect(first.sequence).toBe(0);
    expect(second.sequence).toBe(1);
  });

  it('events stream resumes after the provided sequence number', async () => {
    writeProjectConfig(root);
    const outputDir = path.join(root, 'output');
    const stateManager = new StateManager(outputDir);
    const state = stateManager.initRun('run_resume', 'demo', 'input', ['draft']);
    stateManager.updateRun(state, { status: 'completed', completedAt: Date.now() });

    const logger = new EventLogger(path.join(outputDir, 'demo', 'run_resume', 'events.jsonl'));
    logger.log('workflow.started', { runId: 'run_resume', workflowId: 'demo' });
    logger.log('step.started', { runId: 'run_resume', workflowId: 'demo', stepId: 'draft' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const command = new Command().addCommand(createEventsCommand());

    await parseCommand(command, ['events', 'stream', '--run', 'run_resume', '--json', '--from-sequence', '0', '--no-follow']);

    expect(logSpy).toHaveBeenCalledTimes(1);
    const onlyEvent = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(onlyEvent.type).toBe('step.started');
    expect(onlyEvent.sequence).toBe(1);
  });
});
