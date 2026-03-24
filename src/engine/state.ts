import fs from 'node:fs';
import path from 'node:path';

import { ConfigError } from '../errors.js';
import type { RunState, RunStatus, StepState } from '../types/index.js';

const STATE_FILE = '.state.json';
const RUN_INDEX_FILE = '.runs-index.json';

interface RunIndexEntry {
  workflowId: string;
  status: RunStatus;
  startedAt: number;
  completedAt?: number;
}

type RunIndex = Record<string, RunIndexEntry>;

function atomicWriteJson(filePath: string, value: unknown): void {
  const tmpFile = `${filePath}.tmp`;
  fs.writeFileSync(tmpFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpFile, filePath);
}

export class StateManager {
  constructor(private readonly outputDir: string) {}

  getOutputDir(): string {
    return this.outputDir;
  }

  private getRunIndexPath(): string {
    return path.join(this.outputDir, RUN_INDEX_FILE);
  }

  private readRunIndex(): RunIndex {
    const indexPath = this.getRunIndexPath();
    if (!fs.existsSync(indexPath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }
      return parsed as RunIndex;
    } catch {
      return {};
    }
  }

  private writeRunIndex(index: RunIndex): void {
    fs.mkdirSync(this.outputDir, { recursive: true });
    atomicWriteJson(this.getRunIndexPath(), index);
  }

  private upsertRunIndex(state: RunState): void {
    const index = this.readRunIndex();
    index[state.runId] = {
      workflowId: state.workflowId,
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
    };
    this.writeRunIndex(index);
  }

  private scanAllRuns(): RunState[] {
    if (!fs.existsSync(this.outputDir)) {
      return [];
    }
    const workflowDirs = fs
      .readdirSync(this.outputDir)
      .map((name) => path.join(this.outputDir, name))
      .filter((fullPath) => fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory());

    const allRuns: RunState[] = [];
    for (const workflowDir of workflowDirs) {
      const runDirs = fs
        .readdirSync(workflowDir)
        .map((name) => path.join(workflowDir, name))
        .filter((fullPath) => fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory());

      for (const runDir of runDirs) {
        const stateFilePath = path.join(runDir, STATE_FILE);
        if (!fs.existsSync(stateFilePath)) {
          continue;
        }
        const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8')) as RunState;
        allRuns.push(state);
      }
    }

    return allRuns;
  }

  private rebuildRunIndex(runs: RunState[]): void {
    const index: RunIndex = {};
    for (const run of runs) {
      index[run.runId] = {
        workflowId: run.workflowId,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      };
    }
    this.writeRunIndex(index);
  }

  generateRunId(): string {
    const now = new Date();
    const pad = (value: number): string => value.toString().padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `run_${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
  }

  getRunDir(workflowId: string, runId: string): string {
    return path.join(this.outputDir, workflowId, runId);
  }

  initRun(
    runId: string,
    workflowId: string,
    input: string,
    stepIds: string[],
    inputData?: Record<string, unknown>,
    options?: {
      sourceRunId?: string;
      recoveryInfo?: { reusedStepIds: string[]; rerunStepIds: string[] };
    },
  ): RunState {
    const runDir = this.getRunDir(workflowId, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const steps: Record<string, StepState> = {};
    for (const stepId of stepIds) {
      steps[stepId] = { status: 'pending' };
    }

    const state: RunState = {
      runId,
      workflowId,
      status: 'running',
      input,
      inputData,
      startedAt: Date.now(),
      steps,
      sourceRunId: options?.sourceRunId,
      recoveryInfo: options?.recoveryInfo,
    };

    atomicWriteJson(path.join(runDir, STATE_FILE), state);
    this.upsertRunIndex(state);
    return state;
  }

  loadRun(runId: string, workflowId: string): RunState {
    const filePath = path.join(this.getRunDir(workflowId, runId), STATE_FILE);
    if (!fs.existsSync(filePath)) {
      throw new ConfigError(`Run state not found: ${filePath}`);
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RunState;
  }

  findRunById(runId: string): RunState {
    const index = this.readRunIndex();
    const indexed = index[runId];
    if (indexed) {
      try {
        return this.loadRun(runId, indexed.workflowId);
      } catch {
        // Fall through to full scan if index is stale.
      }
    }

    const runs = this.scanAllRuns();
    const match = runs.find((run) => run.runId === runId);
    if (!match) {
      throw new ConfigError(`Run not found: ${runId}`);
    }
    this.upsertRunIndex(match);
    return match;
  }

  updateStep(state: RunState, stepId: string, update: Partial<StepState>): void {
    const current = state.steps[stepId];
    if (!current) {
      throw new ConfigError(`Unknown step state: ${stepId}`);
    }
    state.steps[stepId] = { ...current, ...update };
    atomicWriteJson(path.join(this.getRunDir(state.workflowId, state.runId), STATE_FILE), state);
  }

  updateRun(state: RunState, update: Partial<RunState>): void {
    Object.assign(state, update);
    atomicWriteJson(path.join(this.getRunDir(state.workflowId, state.runId), STATE_FILE), state);
    this.upsertRunIndex(state);
  }

  listRuns(filter?: { workflowId?: string; status?: RunStatus }): RunState[] {
    const allRuns = this.scanAllRuns();
    this.rebuildRunIndex(allRuns);

    return allRuns
      .filter((run) => {
        if (filter?.workflowId && run.workflowId !== filter.workflowId) {
          return false;
        }
        if (filter?.status && run.status !== filter.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.startedAt - a.startedAt);
  }
}
