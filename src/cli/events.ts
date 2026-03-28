/**
 * Events stream CLI command.
 *
 * Provides a stable event stream for external agents to monitor long-running workflows.
 *
 * @see docs/EVENT-CONTRACT.md
 * @see docs/future/F4-EVENT-STREAM-TASK-CARD.md
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { Command } from 'commander';

import { ConfigLoader } from '../config/loader.js';
import { StateManager } from '../engine/state.js';
import type { LogEvent } from '../types/index.js';

/**
 * Stable event schema for external consumption.
 */
export interface StableEvent {
  type: string;
  runId: string;
  workflowId: string;
  sequence: number;
  ts: number;
  [key: string]: unknown;
}

/**
 * Default heartbeat interval in seconds.
 */
const DEFAULT_HEARTBEAT_SECONDS = 15;

/**
 * Convert internal LogEvent to stable external event format.
 */
function toStableEvent(logEvent: LogEvent, runId: string, workflowId: string, sequence: number): StableEvent {
  const base: StableEvent = {
    type: logEvent.event,
    runId,
    workflowId,
    sequence,
    ts: logEvent.ts,
  };

  // Merge data fields
  for (const [key, value] of Object.entries(logEvent.data)) {
    if (value !== undefined) {
      base[key] = value;
    }
  }

  return base;
}

/**
 * Read events from events.jsonl file.
 */
async function* readEventsFromJsonl(
  filePath: string,
  fromSequence: number,
  runId: string,
  workflowId: string,
): AsyncGenerator<{ event: StableEvent; raw: LogEvent }> {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let sequence = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const rawEvent = JSON.parse(line) as LogEvent;
      if (sequence > fromSequence) {
        const event = toStableEvent(
          rawEvent,
          (rawEvent.data.runId as string) ?? runId,
          (rawEvent.data.workflowId as string) ?? workflowId,
          sequence,
        );
        yield { event, raw: rawEvent };
      }
      sequence++;
    } catch {
      // Skip malformed lines
    }
  }
}

function resolveOutputBaseDir(projectRoot: string): string {
  try {
    const loader = new ConfigLoader(projectRoot);
    const projectConfig = loader.loadProjectConfig();
    return path.resolve(projectRoot, projectConfig.output.base_directory);
  } catch {
    return path.resolve(projectRoot, '.runs');
  }
}

/**
 * Get the output directory for a run.
 */
function getRunOutputDir(projectRoot: string, runId: string): { outputDir: string; workflowId: string } | null {
  const stateManager = new StateManager(resolveOutputBaseDir(projectRoot));
  try {
    const run = stateManager.findRunById(runId);
    const outputDir = stateManager.getRunDir(run.workflowId, runId);
    return { outputDir, workflowId: run.workflowId };
  } catch {
    return null;
  }
}

/**
 * Check if a run is still active.
 */
function isRunActive(projectRoot: string, runId: string): boolean {
  const stateManager = new StateManager(resolveOutputBaseDir(projectRoot));
  try {
    const run = stateManager.findRunById(runId);
    return run.status === 'running';
  } catch {
    return false;
  }
}

/**
 * Create the events stream command.
 */
export function createEventsCommand(): Command {
  const command = new Command('events');

  command
    .description('Stream events from a workflow run')
    .command('stream')
    .description('Stream events from a specific run in JSONL format')
    .requiredOption('--run <runId>', 'Run ID to stream events from')
    .option('--json', 'Output in JSONL format (required)', true)
    .option('--from-sequence <n>', 'Replay events after the given sequence number', (v) => parseInt(v, 10), -1)
    .option('--follow', 'Follow the run until completion', true)
    .option('--no-follow', 'Exit after reading available events')
    .option('--heartbeat-seconds <n>', 'Heartbeat interval in seconds', (v) => parseInt(v, 10), DEFAULT_HEARTBEAT_SECONDS)
    .action(async (options) => {
      const projectRoot = process.cwd();
      const runId = options.run;
      const fromSequence = options.fromSequence ?? -1;
      const follow = options.follow !== false;
      const heartbeatSeconds = options.heartbeatSeconds ?? DEFAULT_HEARTBEAT_SECONDS;

      // Find the run's output directory
      const runInfo = getRunOutputDir(projectRoot, runId);

      if (!runInfo) {
        console.error(JSON.stringify({
          type: 'error',
          error: `Run "${runId}" not found`,
          code: 2,
        }));
        process.exit(2);
      }

      const { outputDir, workflowId } = runInfo;
      const eventsFile = path.join(outputDir, 'events.jsonl');

      // Check if events file exists
      if (!fs.existsSync(eventsFile)) {
        // No events yet, might be a new run
        if (!isRunActive(projectRoot, runId)) {
          console.error(JSON.stringify({
            type: 'error',
            error: `No events found for run "${runId}"`,
            code: 3,
          }));
          process.exit(3);
        }
      }

      let lastSequence = fromSequence - 1;
      let lastEventTime = Date.now();
      let heartbeatTimer: NodeJS.Timeout | null = null;

      // Setup heartbeat
      if (follow && heartbeatSeconds > 0) {
        heartbeatTimer = setInterval(() => {
          const now = Date.now();
          if (now - lastEventTime >= heartbeatSeconds * 1000) {
            const heartbeat: StableEvent = {
              type: 'heartbeat',
              runId,
              workflowId,
              sequence: lastSequence >= 0 ? lastSequence : 0,
              ts: now,
            };
            console.log(JSON.stringify(heartbeat));
            lastEventTime = now;
          }
        }, heartbeatSeconds * 1000);
      }

      try {
        // Read historical events
        for await (const { event } of readEventsFromJsonl(eventsFile, fromSequence, runId, workflowId)) {
          console.log(JSON.stringify(event));
          lastSequence = event.sequence;
          lastEventTime = event.ts;
        }

        // If not following, exit now
        if (!follow) {
          return;
        }

        // Check if run is still active
        if (!isRunActive(projectRoot, runId)) {
          return;
        }

        // Follow for new events (polling-based for simplicity)
        // In a production system, this would use file watching or event subscription
        const pollInterval = 1000; // 1 second
        let fileSize = fs.existsSync(eventsFile) ? fs.statSync(eventsFile).size : 0;

        while (isRunActive(projectRoot, runId)) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval));

          const newFileSize = fs.existsSync(eventsFile) ? fs.statSync(eventsFile).size : 0;
          if (newFileSize > fileSize) {
            // Read new content
            const fd = fs.openSync(eventsFile, 'r');
            const buffer = Buffer.alloc(newFileSize - fileSize);
            fs.readSync(fd, buffer, 0, buffer.length, fileSize);
            fs.closeSync(fd);

            const newContent = buffer.toString('utf8');
            const lines = newContent.split('\n').filter((l) => l.trim());

            for (const line of lines) {
              try {
                const rawEvent = JSON.parse(line) as LogEvent;
                lastSequence++;
                const event = toStableEvent(rawEvent, runId, workflowId, lastSequence);
                console.log(JSON.stringify(event));
                lastEventTime = event.ts;
              } catch {
                // Skip malformed lines
              }
            }

            fileSize = newFileSize;
          }
        }
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
      }
    });

  return command;
}
