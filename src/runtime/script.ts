import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

import { RuntimeError } from '../errors.js';
import type { AgentRuntime, ExecuteParams, ExecuteResult } from '../types/index.js';

interface ScriptRuntimeConfig {
  projectRoot: string;
  scriptFile?: string;
  scriptInline?: string;
}

export class ScriptRuntime implements AgentRuntime {
  private readonly config: ScriptRuntimeConfig;
  private readonly nodeRequire = createRequire(import.meta.url);
  private readonly allowedModules = new Set(['fs', 'path', 'url', 'util', 'crypto', 'os']);

  constructor(config: ScriptRuntimeConfig) {
    this.config = config;
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const startedAt = Date.now();
    const scriptCode = this.loadScript();
    const timeoutMs = params.timeoutSeconds * 1000;

    try {
      const sandbox = {
        require: this.safeRequire.bind(this),
        console: { log: console.log, error: console.error, warn: console.warn },
        __input: params.userPrompt,
        __systemPrompt: params.systemPrompt,
        process: { env: { ...process.env }, cwd: () => this.config.projectRoot },
      };

      const context = vm.createContext(sandbox);
      const wrappedScript = `
        (async function() {
          const input = __input;
          const systemPrompt = __systemPrompt;
          ${scriptCode}
        })();
      `;
      const script = new vm.Script(wrappedScript);

      // vm timeout protects against sync CPU-bound loops (e.g. while(true) {}).
      const executionPromise = Promise.resolve(script.runInContext(context, { timeout: timeoutMs }));

      // Promise.race protects async scripts that never resolve.
      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RuntimeError(`Script execution timed out after ${params.timeoutSeconds}s`, 'script-runtime'));
        }, timeoutMs);
      });

      let result: unknown;
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }

      const output = this.serializeResult(result);
      return { output, duration: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'script execution failed';
      throw new RuntimeError(`Script execution failed: ${message}`, 'script-runtime');
    }
  }

  private serializeResult(result: unknown): string {
    if (result === null || result === undefined) {
      return '';
    }
    if (typeof result === 'string') {
      return result;
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  private loadScript(): string {
    if (this.config.scriptInline) {
      return this.config.scriptInline;
    }
    if (this.config.scriptFile) {
      const fullPath = path.resolve(this.config.projectRoot, this.config.scriptFile);
      if (!fs.existsSync(fullPath)) {
        throw new RuntimeError(`Script file not found: ${fullPath}`, 'script-runtime');
      }
      return fs.readFileSync(fullPath, 'utf8');
    }
    throw new RuntimeError('No script file or inline script provided', 'script-runtime');
  }

  private safeRequire(id: string): unknown {
    const normalizedId = id.startsWith('node:') ? id.slice('node:'.length) : id;
    if (this.allowedModules.has(normalizedId)) {
      return this.nodeRequire(id.startsWith('node:') ? id : `node:${normalizedId}`);
    }
    if (id.startsWith('./') || id.startsWith('../')) {
      return this.nodeRequire(path.resolve(this.config.projectRoot, id));
    }
    throw new Error(`Module "${id}" is not allowed in script runtime. Allowed: ${Array.from(this.allowedModules).join(', ')}`);
  }
}