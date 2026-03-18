import fs from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RuntimeError } from '../errors.js';
import { ScriptRuntime } from '../runtime/script.js';

const tempDir = path.join(process.cwd(), 'test-script-runtime-temp');

describe('ScriptRuntime', () => {
  let runtime: ScriptRuntime;

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('inline script execution', () => {
    it('executes inline script and returns string result', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'return "hello world"',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'user input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('hello world');
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('converts non-string result to JSON', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'return { message: "test", count: 42 }',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'user input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(JSON.parse(result.output)).toEqual({ message: 'test', count: 42 });
    });

    it('returns empty string when no return value', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const x = 1 + 1;',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'user input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('');
    });
  });

  describe('input variable', () => {
    it('provides userPrompt as input variable', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'return `Received: ${input}`',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'test input value',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('Received: test input value');
    });

    it('provides systemPrompt as systemPrompt variable', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'return `System: ${systemPrompt}`',
      });

      const result = await runtime.execute({
        systemPrompt: 'be helpful',
        userPrompt: 'user input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('System: be helpful');
    });
  });

  describe('script file loading', () => {
    it('loads and executes script from file', async () => {
      const scriptPath = path.join(tempDir, 'test-script.js');
      fs.writeFileSync(scriptPath, 'return "from file: " + input', 'utf8');

      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptFile: 'test-script.js',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'hello',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('from file: hello');
    });

    it('throws error for non-existent script file', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptFile: 'non-existent.js',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow(RuntimeError);
    });
  });

  describe('allowed modules', () => {
    it('blocks require of fs module for security', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const fs = require("fs"); return typeof fs.readFileSync === "function" ? "yes" : "no"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('is not allowed');
    });

    it('blocks require of path module for security', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const path = require("path"); return typeof path.join === "function" ? "yes" : "no"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('is not allowed');
    });

    it('blocks relative imports for security', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const mod = require("./some-module"); return "should not reach"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('is not allowed');
    });

    it('allows require of safe modules like util', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const util = require("util"); return typeof util.inspect === "function" ? "yes" : "no"',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('yes');
    });

    it('allows require of os module', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const os = require("os"); return typeof os.platform === "function" ? "yes" : "no"',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('yes');
    });

    it('throws error for disallowed module like child_process', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'const child = require("child_process"); return "should not reach"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('is not allowed');
    });
  });

  describe('timeout handling', () => {
    it('throws error on sync infinite loop timeout', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'while(true) {}',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 1,
        }),
      ).rejects.toThrow(RuntimeError);
    }, 10000);

    it('throws error on async script timeout', async () => {
      // Script that awaits forever - this can be properly interrupted by Promise.race
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'await new Promise(() => {}); return "should not reach"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 1,
        }),
      ).rejects.toThrow(RuntimeError);
    }, 10000);

    it('throws timeout error with correct message', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'await new Promise(() => {}); return "should not reach"',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 2,
        }),
      ).rejects.toThrow('timed out after 2s');
    }, 10000);
  });

  describe('error handling', () => {
    it('throws RuntimeError on script error', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'throw new Error("script error")',
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow(RuntimeError);
    });

    it('throws error when no script provided', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('No script file or inline script provided');
    });
  });

  describe('filesystem operations', () => {
    it('blocks filesystem access for security', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: `
const fs = require('fs');
const path = require('path');
const filePath = path.join(process.cwd(), 'data.txt');
fs.writeFileSync(filePath, 'test');
return fs.readFileSync(filePath, 'utf-8');
        `,
      });

      await expect(
        runtime.execute({
          systemPrompt: 'system',
          userPrompt: 'input',
          model: '',
          timeoutSeconds: 10,
        }),
      ).rejects.toThrow('is not allowed');
    });
  });

  describe('environment variables', () => {
    it('filters sensitive env vars from process.env', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: `
const keys = Object.keys(process.env);
const hasSecret = keys.some(k => k.includes('SECRET') || k.includes('API_KEY') || k.includes('PASSWORD'));
return hasSecret ? "SENSITIVE_DATA_LEAKED" : "SAFE";
        `,
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'input',
        model: '',
        timeoutSeconds: 10,
      });

      expect(result.output).toBe('SAFE');
    });

    it('allows safe env vars like PATH', async () => {
      runtime = new ScriptRuntime({
        projectRoot: tempDir,
        scriptInline: 'return process.env.PATH ? "HAS_PATH" : "NO_PATH"',
      });

      const result = await runtime.execute({
        systemPrompt: 'system',
        userPrompt: 'input',
        model: '',
        timeoutSeconds: 10,
      });

      // PATH may or may not be set, but it shouldn't throw an error
      expect(['HAS_PATH', 'NO_PATH']).toContain(result.output);
    });
  });
});