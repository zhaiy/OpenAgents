import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError } from '../errors.js';
import { StateManager } from '../engine/state.js';

const tempDirs: string[] = [];

function makeManager(): { manager: StateManager; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openagents-state-'));
  tempDirs.push(root);
  return { manager: new StateManager(root), root };
}

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('StateManager', () => {
  it('creates and loads run state', () => {
    const { manager } = makeManager();
    const state = manager.initRun('run_1', 'wf_1', 'input', ['step_a', 'step_b']);

    const loaded = manager.loadRun(state.runId, state.workflowId);
    expect(loaded.runId).toBe('run_1');
    expect(loaded.workflowId).toBe('wf_1');
    expect(loaded.steps.step_a.status).toBe('pending');
  });

  it('updates step and persists atomically', () => {
    const { manager } = makeManager();
    const state = manager.initRun('run_1', 'wf_1', 'input', ['step_a']);
    manager.updateStep(state, 'step_a', { status: 'completed', outputFile: 'step_a.md' });

    const runDir = manager.getRunDir('wf_1', 'run_1');
    const stateFile = path.join(runDir, '.state.json');
    const tmpFile = `${stateFile}.tmp`;
    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as { steps: Record<string, { status: string }> };

    expect(persisted.steps.step_a.status).toBe('completed');
    expect(fs.existsSync(tmpFile)).toBe(false);
  });

  it('persists workflow snapshot and source relationship metadata', () => {
    const { manager } = makeManager();
    const state = manager.initRun(
      'run_1',
      'wf_1',
      'input',
      ['step_a'],
      { foo: 'bar' },
      {
        sourceRunId: 'run_source',
        sourceRunRelationship: 'rerun_with_edits',
        workflowSnapshot: {
          workflowId: 'wf_1',
          versionHash: 'hash_123',
          capturedAt: 123456,
          steps: {
            step_a: {
              id: 'step_a',
              agent: { id: 'agent_a', name: 'Agent A', runtimeType: 'llm-direct' },
              systemPrompt: 'prompt',
              task: 'task',
              dependsOn: [],
              gate: 'auto',
            },
          },
        },
      },
    );

    const loaded = manager.loadRun(state.runId, state.workflowId);
    expect(loaded.sourceRunRelationship).toBe('rerun_with_edits');
    expect(loaded.workflowSnapshot?.versionHash).toBe('hash_123');
    expect(loaded.workflowSnapshot?.steps.step_a.agent.id).toBe('agent_a');
  });

  it('lists runs and supports filters', () => {
    const { manager } = makeManager();
    const run1 = manager.initRun('run_1', 'wf_1', 'input1', ['s1']);
    manager.updateRun(run1, { status: 'completed', completedAt: Date.now() });
    const run2 = manager.initRun('run_2', 'wf_2', 'input2', ['s2']);
    manager.updateRun(run2, { status: 'interrupted', completedAt: Date.now() });

    expect(manager.listRuns().length).toBe(2);
    expect(manager.listRuns({ workflowId: 'wf_1' }).length).toBe(1);
    expect(manager.listRuns({ status: 'interrupted' }).length).toBe(1);
  });

  it('finds run by id and throws for missing run', () => {
    const { manager } = makeManager();
    manager.initRun('run_1', 'wf_1', 'input', ['s1']);

    const found = manager.findRunById('run_1');
    expect(found.workflowId).toBe('wf_1');
    expect(() => manager.findRunById('missing')).toThrowError(ConfigError);
  });

  it('writes run index and updates status in index', () => {
    const { manager, root } = makeManager();
    const state = manager.initRun('run_1', 'wf_1', 'input', ['s1']);
    manager.updateRun(state, { status: 'completed', completedAt: Date.now() });

    const indexPath = path.join(root, '.runs-index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<
      string,
      { workflowId: string; status: string }
    >;

    expect(index.run_1.workflowId).toBe('wf_1');
    expect(index.run_1.status).toBe('completed');
  });

  it('falls back to full scan when index is stale', () => {
    const { manager, root } = makeManager();
    manager.initRun('run_1', 'wf_1', 'input', ['s1']);
    fs.writeFileSync(
      path.join(root, '.runs-index.json'),
      JSON.stringify({
        run_1: {
          workflowId: 'wrong_workflow',
          status: 'running',
          startedAt: Date.now(),
        },
      }),
      'utf8',
    );

    const found = manager.findRunById('run_1');
    expect(found.workflowId).toBe('wf_1');
  });
});
