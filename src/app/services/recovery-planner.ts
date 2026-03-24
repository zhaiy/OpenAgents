import type { StepConfig, StepStatus } from '../../types/index.js';

type RecoveryLikeStepState = {
  status: string;
  outputFile?: string;
  error?: string;
};

export interface RecoveryClassificationItem {
  stepId: string;
  currentStatus: StepStatus | 'unknown';
  reason: string;
}

export interface RecoveryClassification {
  reused: RecoveryClassificationItem[];
  rerun: RecoveryClassificationItem[];
  invalidated: RecoveryClassificationItem[];
  atRisk: RecoveryClassificationItem[];
}

export interface RecoveryPlanningOptions {
  resumeFromStep?: string;
  reuseSteps?: string[];
  forceRerunSteps?: string[];
  requireOutputForReuse?: boolean;
}

function buildDependencyMaps(stepConfigs: StepConfig[]): {
  dependencyMap: Map<string, string[]>;
  reverseDependencyMap: Map<string, string[]>;
} {
  const dependencyMap = new Map<string, string[]>();
  const reverseDependencyMap = new Map<string, string[]>();

  for (const step of stepConfigs) {
    dependencyMap.set(step.id, step.depends_on ?? []);
    reverseDependencyMap.set(step.id, []);
  }

  for (const [stepId, dependencies] of dependencyMap.entries()) {
    for (const dependency of dependencies) {
      const downstream = reverseDependencyMap.get(dependency) ?? [];
      downstream.push(stepId);
      reverseDependencyMap.set(dependency, downstream);
    }
  }

  return { dependencyMap, reverseDependencyMap };
}

function collectDownstream(
  roots: Iterable<string>,
  reverseDependencyMap: Map<string, string[]>,
): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    queue.push(...(reverseDependencyMap.get(current) ?? []));
  }

  return visited;
}

function buildRerunRootSet(
  stepStates: Record<string, RecoveryLikeStepState>,
  options: RecoveryPlanningOptions,
): Set<string> {
  const rerunRoots = new Set<string>(options.forceRerunSteps ?? []);

  if (options.resumeFromStep) {
    rerunRoots.add(options.resumeFromStep);
  }

  for (const [stepId, stepState] of Object.entries(stepStates)) {
    if (
      stepState.status === 'failed' ||
      stepState.status === 'pending' ||
      stepState.status === 'running' ||
      stepState.status === 'gate_waiting' ||
      stepState.status === 'interrupted'
    ) {
      rerunRoots.add(stepId);
    }
  }

  return rerunRoots;
}

function getOrderedStepIds(
  stepStates: Record<string, RecoveryLikeStepState>,
  stepConfigs: StepConfig[],
): string[] {
  const ordered = stepConfigs.map((step) => step.id);
  for (const stepId of Object.keys(stepStates)) {
    if (!ordered.includes(stepId)) {
      ordered.push(stepId);
    }
  }
  return ordered;
}

export function classifyRecoverySteps(
  stepStates: Record<string, RecoveryLikeStepState>,
  stepConfigs: StepConfig[],
  options: RecoveryPlanningOptions,
): RecoveryClassification {
  const result: RecoveryClassification = {
    reused: [],
    rerun: [],
    invalidated: [],
    atRisk: [],
  };

  const { reverseDependencyMap } = buildDependencyMaps(stepConfigs);
  const rerunRoots = buildRerunRootSet(stepStates, options);
  const impactedClosure = collectDownstream(rerunRoots, reverseDependencyMap);
  const downstreamOfRerun = new Set([...impactedClosure].filter((stepId) => !rerunRoots.has(stepId)));
  const explicitReuseSteps = options.reuseSteps ? new Set(options.reuseSteps) : undefined;
  const requireOutputForReuse = options.requireOutputForReuse ?? true;

  for (const stepId of getOrderedStepIds(stepStates, stepConfigs)) {
    const stepState = stepStates[stepId];
    const currentStatus = (stepState?.status ?? 'unknown') as StepStatus | 'unknown';
    const hasReusableOutput = currentStatus === 'completed' && (requireOutputForReuse ? Boolean(stepState?.outputFile) : true);

    if (rerunRoots.has(stepId)) {
      let reason = 'Will be re-executed';
      if (options.forceRerunSteps?.includes(stepId)) {
        reason = 'Explicitly requested to force rerun';
      } else if (options.resumeFromStep === stepId) {
        reason = 'Resume point - will be re-executed';
      } else if (currentStatus === 'failed') {
        reason = stepState?.error ? `Failed: ${stepState.error.substring(0, 50)}` : 'Failed';
      } else if (currentStatus !== 'unknown') {
        reason = `Not completed (${currentStatus})`;
      }
      result.rerun.push({ stepId, currentStatus, reason });
      continue;
    }

    if (downstreamOfRerun.has(stepId)) {
      if (hasReusableOutput) {
        result.invalidated.push({
          stepId,
          currentStatus,
          reason: 'Downstream of re-executed step - completed output will be regenerated',
        });
      } else {
        result.rerun.push({
          stepId,
          currentStatus,
          reason: 'Downstream of re-executed step - must run again',
        });
      }
      continue;
    }

    if (hasReusableOutput) {
      if (explicitReuseSteps && !explicitReuseSteps.has(stepId)) {
        result.rerun.push({
          stepId,
          currentStatus,
          reason: 'Not selected for reuse',
        });
      } else {
        result.reused.push({
          stepId,
          currentStatus,
          reason: explicitReuseSteps?.has(stepId) ? 'Explicitly requested for reuse' : 'Completed with valid output',
        });
      }
      continue;
    }

    if (currentStatus === 'skipped') {
      result.atRisk.push({
        stepId,
        currentStatus,
        reason: 'Skipped in source run - may remain skipped if dependencies are unchanged',
      });
    }
  }

  return result;
}
