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

// Sandboxed modules allowed in script runtime.
// SECURITY: fs and path are intentionally excluded to prevent arbitrary file access.
// Only pure utility modules with no side effects are allowed.
const ALLOWED_MODULES = new Set(['util', 'crypto', 'os', 'url']);

// Non-sensitive environment variables that can be passed to scripts
const SAFE_ENV_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LANG',
  'LC_ALL',
  'SHELL',
  'TERM',
  'TMPDIR',
  'NODE_ENV',
]);

export class ScriptRuntime implements AgentRuntime {
  private readonly config: ScriptRuntimeConfig;
  private readonly nodeRequire = createRequire(import.meta.url);

  constructor(config: ScriptRuntimeConfig) {
    this.config = config;
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const startedAt = Date.now();
    const scriptCode = this.loadScript();
    const timeoutMs = params.timeoutSeconds * 1000;

    try {
      const sandbox = Object.create(null) as {
        require: (id: string) => unknown;
        __input: string;
        __systemPrompt: string;
        process: { env: Record<string, string | undefined> };
        __print: (_msg: string) => void;
      };

      // SECURITY: Create a minimal sandbox with restricted access.
      // - No fs/path modules: prevents arbitrary file system access
      // - Filtered env vars: prevents API key leakage
      // - No console: prevents information disclosure
      // - No cwd: prevents directory enumeration
      sandbox.require = this.safeRequire.bind(this);
      sandbox.__input = params.userPrompt;
      sandbox.__systemPrompt = params.systemPrompt;
      sandbox.process = {
        env: this.filterEnvVars(),
      };
      sandbox.__print = (_msg: string): void => {
        void _msg; // Silently absorb print output to prevent info leakage
      };

      const context = vm.createContext(sandbox, {
        codeGeneration: {
          strings: false,
          wasm: false,
        },
      });
      // SECURITY: Wrap script with input variables only, no console access
      const wrappedScript = `
        (async function() {
          const input = __input;
          const systemPrompt = __systemPrompt;
          const print = __print;
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
    // SECURITY: Only allow safe utility modules, block fs/path for file access
    const normalizedId = id.startsWith('node:') ? id.slice('node:'.length) : id;
    if (ALLOWED_MODULES.has(normalizedId)) {
      return this.nodeRequire(id.startsWith('node:') ? id : `node:${normalizedId}`);
    }
    // Block relative imports that could load arbitrary files
    if (id.startsWith('./') || id.startsWith('../')) {
      throw new Error(
        `Module "${id}" is not allowed. Relative imports are disabled in sandboxed script runtime for security.`,
      );
    }
    throw new Error(
      `Module "${id}" is not allowed in script runtime. Allowed: ${Array.from(ALLOWED_MODULES).join(', ')}. ` +
        'Note: fs and path modules are disabled for security.',
    );
  }

  private filterEnvVars(): Record<string, string | undefined> {
    // SECURITY: Only pass non-sensitive environment variables to scripts
    const filtered: Record<string, string | undefined> = {};
    for (const key of SAFE_ENV_VARS) {
      if (process.env[key] !== undefined) {
        filtered[key] = process.env[key];
      }
    }
    return filtered;
  }
}
