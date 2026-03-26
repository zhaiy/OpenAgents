import { describe, expect, it } from 'vitest';

import type { AgentConfig, ProjectConfig } from '../types/index.js';
import { createRuntime } from '../runtime/factory.js';
import { ScriptRuntime } from '../runtime/script.js';

const projectConfig: ProjectConfig = {
  version: '1',
  runtime: {
    default_type: 'llm-direct',
    default_model: 'qwen-plus',
    api_base_url: 'https://dashscope.aliyuncs.com/compatible-mode',
  },
  retry: {
    max_attempts: 2,
    delay_seconds: 5,
  },
  output: {
    base_directory: './output',
    preview_lines: 10,
  },
};

describe('runtime factory', () => {
  it('creates llm-direct runtime', () => {
    process.env.OPENAGENTS_API_KEY = 'test-key';
    const runtime = createRuntime('llm-direct', projectConfig);
    expect(runtime).toBeTruthy();
    delete process.env.OPENAGENTS_API_KEY;
  });

  it('creates script runtime with inline script', () => {
    const agentConfig: AgentConfig = {
      agent: { id: 'test', name: 'Test', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: { type: 'script', model: '', timeout_seconds: 30 },
      script: { inline: 'return "hello"' },
    };
    const runtime = createRuntime('script', projectConfig, agentConfig);
    expect(runtime).toBeInstanceOf(ScriptRuntime);
  });

  it('creates script runtime with script file', () => {
    const agentConfig: AgentConfig = {
      agent: { id: 'test', name: 'Test', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: { type: 'script', model: '', timeout_seconds: 30 },
      script: { file: 'scripts/test.js' },
    };
    const runtime = createRuntime('script', projectConfig, agentConfig);
    expect(runtime).toBeInstanceOf(ScriptRuntime);
  });

  it('throws for unsupported runtime', () => {
    // Cast is used only to test fallback branch.
    expect(() => createRuntime('openclaw', projectConfig)).toThrow();
  });
});

describe('per-agent api config priority', () => {
  it('uses agent-level api_key over project-level', () => {
    // Clean env
    delete process.env.OPENAGENTS_API_KEY;
    delete process.env.OPENAGENTS_API_BASE_URL;

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'qwen-plus',
        api_key: 'agent-level-key',
        timeout_seconds: 30,
      },
    };

    // Should not throw because agent has its own api_key
    const runtime = createRuntime('llm-direct', projectConfig, agentConfig);
    expect(runtime).toBeTruthy();
  });

  it('uses agent-level api_base_url over project-level', () => {
    process.env.OPENAGENTS_API_KEY = 'test-key';

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'qwen-plus',
        api_base_url: 'https://agent-specific.api.com/v1',
        timeout_seconds: 30,
      },
    };

    const runtime = createRuntime('llm-direct', projectConfig, agentConfig);
    expect(runtime).toBeTruthy();

    delete process.env.OPENAGENTS_API_KEY;
  });

  it('falls back to project-level api_key when agent has none', () => {
    delete process.env.OPENAGENTS_API_KEY;
    delete process.env.OPENAGENTS_API_BASE_URL;

    const projectConfigWithKey: ProjectConfig = {
      ...projectConfig,
      runtime: {
        ...projectConfig.runtime,
        api_key: 'project-level-key',
      },
    };

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'qwen-plus',
        // No api_key specified - should use project-level
        timeout_seconds: 30,
      },
    };

    // Should not throw because project has api_key
    const runtime = createRuntime('llm-direct', projectConfigWithKey, agentConfig);
    expect(runtime).toBeTruthy();
  });

  it('falls back to env var when neither agent nor project has api_key', () => {
    process.env.OPENAGENTS_API_KEY = 'env-level-key';

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'qwen-plus',
        timeout_seconds: 30,
      },
    };

    // Should not throw because env var is set
    const runtime = createRuntime('llm-direct', projectConfig, agentConfig);
    expect(runtime).toBeTruthy();

    delete process.env.OPENAGENTS_API_KEY;
  });

  it('throws when no api_key is available anywhere', () => {
    delete process.env.OPENAGENTS_API_KEY;
    delete process.env.OPENAGENTS_API_BASE_URL;

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'qwen-plus',
        timeout_seconds: 30,
      },
    };

    // Should throw because no api_key in agent, project, or env
    expect(() => createRuntime('llm-direct', projectConfig, agentConfig)).toThrow();
  });

  it('uses both agent-level api_key and api_base_url together', () => {
    delete process.env.OPENAGENTS_API_KEY;
    delete process.env.OPENAGENTS_API_BASE_URL;

    const agentConfig: AgentConfig = {
      agent: { id: 'writer', name: 'Writer', description: 'Test agent' },
      prompt: { system: 'test' },
      runtime: {
        type: 'llm-direct',
        model: 'glm-4',
        api_key: 'glm-api-key',
        api_base_url: 'https://open.bigmodel.cn/api/paas/v4',
        timeout_seconds: 300,
      },
    };

    const runtime = createRuntime('llm-direct', projectConfig, agentConfig);
    expect(runtime).toBeTruthy();
  });
});
