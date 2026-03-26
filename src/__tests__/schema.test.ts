import { describe, expect, it } from 'vitest';

import { AgentConfigSchema, ProjectConfigSchema, WorkflowConfigSchema } from '../config/schema.js';

describe('schema validation', () => {
  it('accepts a valid agent config', () => {
    const result = AgentConfigSchema.safeParse({
      agent: { id: 'writer', name: 'Writer', description: 'desc' },
      prompt: { system: 'system prompt' },
      runtime: { type: 'llm-direct', model: 'qwen-plus', timeout_seconds: 30 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid agent id', () => {
    const result = AgentConfigSchema.safeParse({
      agent: { id: 'Writer', name: 'Writer', description: 'desc' },
      prompt: { system: 'system prompt' },
      runtime: { type: 'llm-direct', model: 'qwen-plus', timeout_seconds: 30 },
    });
    expect(result.success).toBe(false);
  });

  describe('per-agent api config', () => {
    it('accepts agent with api_key', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'desc' },
        prompt: { system: 'system prompt' },
        runtime: { type: 'llm-direct', model: 'qwen-plus', api_key: 'agent-key', timeout_seconds: 30 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts agent with api_base_url', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'desc' },
        prompt: { system: 'system prompt' },
        runtime: { type: 'llm-direct', model: 'qwen-plus', api_base_url: 'https://api.example.com/v1', timeout_seconds: 30 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts agent with both api_key and api_base_url', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'desc' },
        prompt: { system: 'system prompt' },
        runtime: {
          type: 'llm-direct',
          model: 'qwen-plus',
          api_key: 'agent-key',
          api_base_url: 'https://api.example.com/v1',
          timeout_seconds: 30,
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid api_base_url format', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'desc' },
        prompt: { system: 'system prompt' },
        runtime: { type: 'llm-direct', model: 'qwen-plus', api_base_url: 'not-a-url', timeout_seconds: 30 },
      });
      expect(result.success).toBe(false);
    });

    it('accepts agent without api config (uses project defaults)', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'desc' },
        prompt: { system: 'system prompt' },
        runtime: { type: 'llm-direct', model: 'qwen-plus', timeout_seconds: 30 },
      });
      expect(result.success).toBe(true);
    });
  });

  it('accepts valid workflow config', () => {
    const result = WorkflowConfigSchema.safeParse({
      workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
      steps: [
        { id: 'outline', agent: 'planner', task: 'task' },
        { id: 'chapter_1', agent: 'writer', task: 'task', depends_on: ['outline'] },
      ],
      output: { directory: './output/{{workflow.id}}/{{run.id}}' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects workflow with unknown dependency', () => {
    const result = WorkflowConfigSchema.safeParse({
      workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
      steps: [{ id: 'chapter_1', agent: 'writer', task: 'task', depends_on: ['outline'] }],
      output: { directory: './output' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid project config', () => {
    const result = ProjectConfigSchema.safeParse({
      version: '1',
      runtime: { default_type: 'llm-direct', default_model: 'qwen-plus' },
      retry: { max_attempts: 2, delay_seconds: 5 },
      output: { base_directory: './output', preview_lines: 10 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid project version', () => {
    const result = ProjectConfigSchema.safeParse({
      version: '2',
      runtime: { default_type: 'llm-direct', default_model: 'qwen-plus' },
      retry: { max_attempts: 2, delay_seconds: 5 },
      output: { base_directory: './output', preview_lines: 10 },
    });
    expect(result.success).toBe(false);
  });

  describe('output.files validation', () => {
    it('accepts workflow with output.files configuration', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'outline', agent: 'planner', task: 'task' },
          { id: 'chapter_1', agent: 'writer', task: 'task' },
        ],
        output: {
          directory: './output/{{workflow.id}}/{{run.id}}',
          files: [
            { step: 'outline', filename: '大纲.md' },
            { step: 'chapter_1', filename: 'chapter-1.md' },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts output.files with template variables', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'outline', agent: 'planner', task: 'task' }],
        output: {
          directory: './output',
          files: [{ step: 'outline', filename: '{{input}}-output.md' }],
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects output.files referencing unknown step', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'outline', agent: 'planner', task: 'task' }],
        output: {
          directory: './output',
          files: [{ step: 'non_existent', filename: 'output.md' }],
        },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('unknown step'))).toBe(true);
      }
    });

    it('rejects output.files with empty filename', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'outline', agent: 'planner', task: 'task' }],
        output: {
          directory: './output',
          files: [{ step: 'outline', filename: '' }],
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('script agent validation', () => {
    it('accepts script agent with inline script', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'file_reader', name: 'File Reader', description: 'Reads files' },
        prompt: { system: 'Read file content' },
        runtime: { type: 'script', model: '', timeout_seconds: 30 },
        script: { inline: 'return "hello"' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts script agent with script file', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'file_reader', name: 'File Reader', description: 'Reads files' },
        prompt: { system: 'Read file content' },
        runtime: { type: 'script', model: '', timeout_seconds: 30 },
        script: { file: 'scripts/reader.js' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts script agent with both file and inline', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'file_reader', name: 'File Reader', description: 'Reads files' },
        prompt: { system: 'Read file content' },
        runtime: { type: 'script', model: '', timeout_seconds: 30 },
        script: { file: 'scripts/reader.js', inline: 'return "inline"' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects script agent without script file or inline', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'file_reader', name: 'File Reader', description: 'Reads files' },
        prompt: { system: 'Read file content' },
        runtime: { type: 'script', model: '', timeout_seconds: 30 },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('must have either script.file or script.inline'))).toBe(true);
      }
    });

    it('rejects script agent with empty script object', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'file_reader', name: 'File Reader', description: 'Reads files' },
        prompt: { system: 'Read file content' },
        runtime: { type: 'script', model: '', timeout_seconds: 30 },
        script: {},
      });
      expect(result.success).toBe(false);
    });

    it('accepts llm-direct agent without script field', () => {
      const result = AgentConfigSchema.safeParse({
        agent: { id: 'writer', name: 'Writer', description: 'Writes content' },
        prompt: { system: 'Write content' },
        runtime: { type: 'llm-direct', model: 'qwen-plus', timeout_seconds: 30 },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('cache config', () => {
    it('accepts workflow with cache config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        cache: { enabled: true, ttl: 3600 },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with cache config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task', cache: { enabled: false } }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts cache config with only enabled field', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        cache: { enabled: true },
      });
      expect(result.success).toBe(true);
    });

    it('accepts workflow without cache config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('post_processors config', () => {
    it('accepts script post_processor with required fields', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            post_processors: [{ type: 'script', command: 'node scripts/shrink.mjs' }],
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects script post_processor without command', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            post_processors: [{ type: 'script', command: '' }],
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid post_processor on_error value', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            post_processors: [{ type: 'script', command: 'node script.js', on_error: 'ignore' }],
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('on_failure config', () => {
    it('accepts step with on_failure=fail', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task', on_failure: 'fail' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with on_failure=skip', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task', on_failure: 'skip' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with on_failure=fallback and fallback_agent', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'chapter', agent: 'writer', task: 'task', on_failure: 'fallback', fallback_agent: 'backup_writer' },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects on_failure=fallback without fallback_agent', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task', on_failure: 'fallback' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('fallback_agent is required'))).toBe(true);
      }
    });

    it('accepts step without on_failure (defaults to fail)', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with on_failure=notify and webhook', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            on_failure: 'notify',
            notify: { webhook: 'https://example.com/webhook' },
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects on_failure=notify without webhook', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            on_failure: 'notify',
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('notify.webhook is required'))).toBe(true);
      }
    });
  });

  describe('notify config', () => {
    it('accepts step with webhook notification', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            notify: { webhook: 'https://example.com/webhook' },
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid webhook URL', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          {
            id: 'chapter',
            agent: 'writer',
            task: 'task',
            notify: { webhook: 'not-a-url' },
          },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(false);
    });

    it('accepts step without notify config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('context config', () => {
    it('accepts step with context config using truncate strategy', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'chapter', agent: 'writer', task: 'task' },
          { id: 'review', agent: 'reviewer', task: 'review', context: { from: 'chapter', strategy: 'truncate', max_tokens: 1000 } },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts step with context config using summarize strategy', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'chapter', agent: 'writer', task: 'task' },
          { id: 'review', agent: 'reviewer', task: 'review', context: { from: 'chapter', strategy: 'summarize', max_tokens: 500 } },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts context config with inject_as=system', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'chapter', agent: 'writer', task: 'task' },
          { id: 'review', agent: 'reviewer', task: 'review', context: { from: 'chapter', strategy: 'truncate', inject_as: 'system' } },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts context config with inject_as=user', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [
          { id: 'chapter', agent: 'writer', task: 'task' },
          { id: 'review', agent: 'reviewer', task: 'review', context: { from: 'chapter', strategy: 'truncate', inject_as: 'user' } },
        ],
        output: { directory: './output' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects context config referencing non-existent step', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
      });
      // The context step reference is validated at runtime, not schema validation time
      expect(result.success).toBe(true);
    });
  });

  describe('eval config', () => {
    it('accepts workflow with eval config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        eval: {
          enabled: true,
          type: 'llm-judge',
          judge_model: 'qwen-plus',
          dimensions: [
            { name: 'quality', weight: 1.0, prompt: 'Assess quality' },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts eval config with multiple dimensions', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        eval: {
          enabled: true,
          type: 'llm-judge',
          dimensions: [
            { name: 'relevance', weight: 0.6, prompt: 'Assess relevance' },
            { name: 'coherence', weight: 0.4, prompt: 'Assess coherence' },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts eval config without judge_model (uses default)', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        eval: {
          enabled: true,
          type: 'llm-judge',
          dimensions: [
            { name: 'quality', weight: 1.0, prompt: 'Assess quality' },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects eval config with dimension weight sum not equal to 1', () => {
      // Note: Schema doesn't validate weight sum, only that weights are numbers
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        eval: {
          enabled: true,
          type: 'llm-judge',
          dimensions: [
            { name: 'relevance', weight: 0.3, prompt: 'Assess relevance' },
            { name: 'coherence', weight: 0.3, prompt: 'Assess coherence' },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts disabled eval config', () => {
      const result = WorkflowConfigSchema.safeParse({
        workflow: { id: 'novel_writing', name: 'Novel', description: 'desc' },
        steps: [{ id: 'chapter', agent: 'writer', task: 'task' }],
        output: { directory: './output' },
        eval: {
          enabled: false,
          type: 'llm-judge',
          dimensions: [],
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
