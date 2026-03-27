import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntime } from '../types/index.js';
import { processContext } from '../engine/context-processor.js';

const mockRuntime: AgentRuntime = {
  execute: vi.fn(async () => ({
    output: '这是摘要内容。',
    duration: 100,
  })),
};

const mockDedicatedRuntime: AgentRuntime = {
  execute: vi.fn(async () => ({
    output: '这是专用模型的摘要内容。',
    duration: 50,
  })),
};

describe('processContext', () => {
  it('returns raw content when strategy is raw', async () => {
    const content = '这是原始内容';
    const result = await processContext({
      rawContent: content,
      strategy: 'raw',
    });
    expect(result).toBe(content);
  });

  it('returns raw content when content is short and strategy is auto', async () => {
    const content = '短内容'; // ~2 tokens
    const result = await processContext({
      rawContent: content,
      strategy: 'auto',
      autoThresholds: { rawLimit: 500, truncateLimit: 2000 },
    });
    expect(result).toBe(content);
  });

  it('truncates content when strategy is truncate', async () => {
    const content = 'a'.repeat(2000); // ~500 tokens
    const result = await processContext({
      rawContent: content,
      strategy: 'truncate',
      maxTokens: 250,
    });
    // maxTokens 250 * 4 chars per token = 1000 chars
    expect(result.length).toBe(1000);
    expect(result).toBe('a'.repeat(1000));
  });

  it('returns full content when truncate maxTokens exceeds content length', async () => {
    const content = 'short';
    const result = await processContext({
      rawContent: content,
      strategy: 'truncate',
      maxTokens: 100,
    });
    expect(result).toBe(content);
  });

  it('uses summarize strategy when content is large', async () => {
    const content = 'a'.repeat(10000); // ~2500 tokens, exceeds truncate threshold
    const result = await processContext({
      rawContent: content,
      strategy: 'summarize',
      maxTokens: 100,
      summarizeRuntime: mockRuntime,
      summarizeModel: 'test-model',
    });
    expect(result).toBe('这是摘要内容。');
    expect(mockRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a text summarization assistant.',
        model: 'test-model',
      }),
    );
  });

  it('auto strategy selects truncate for medium content', async () => {
    const content = 'a'.repeat(4000); // ~1000 tokens (between 500 and 2000)
    const result = await processContext({
      rawContent: content,
      strategy: 'auto',
      autoThresholds: { rawLimit: 500, truncateLimit: 2000 },
    });
    // 4000 chars / 4 = 1000 tokens, exceeds raw limit but under truncate limit
    // Should be truncate (not summarize)
    expect(result.length).toBe(2000); // truncate at default maxTokens (500) * 4 = 2000
  });

  it('throws error when summarize strategy lacks runtime', async () => {
    await expect(
      processContext({
        rawContent: 'some content',
        strategy: 'summarize',
        maxTokens: 100,
      }),
    ).rejects.toThrow('summarize strategy requires summarizeRuntime and summarizeModel');
  });

  it('respects custom auto thresholds', async () => {
    const content = 'a'.repeat(2000); // ~500 tokens
    const result = await processContext({
      rawContent: content,
      strategy: 'auto',
      autoThresholds: { rawLimit: 100, truncateLimit: 200 },
      summarizeRuntime: mockRuntime,
      summarizeModel: 'test-model',
    });
    // 2000 chars / 4 = 500 tokens, exceeds custom truncate limit of 200 tokens
    // Should use summarize
    expect(result).toBe('这是摘要内容。');
  });

  it('uses raw for content exactly at rawLimit threshold', async () => {
    const content = 'a'.repeat(2000); // 2000 chars = ~500 tokens
    const result = await processContext({
      rawContent: content,
      strategy: 'auto',
      autoThresholds: { rawLimit: 500, truncateLimit: 2000 },
    });
    // Exactly at threshold should use raw
    expect(result).toBe(content);
  });

  it('uses dedicated runtime when provided for summarize strategy', async () => {
    const content = 'a'.repeat(10000); // ~2500 tokens
    const result = await processContext({
      rawContent: content,
      strategy: 'summarize',
      maxTokens: 100,
      summarizeRuntime: mockDedicatedRuntime,
      summarizeModel: 'dedicated-model',
    });
    expect(result).toBe('这是专用模型的摘要内容。');
    expect(mockDedicatedRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a text summarization assistant.',
        model: 'dedicated-model',
      }),
    );
  });

  it('uses provided runtime for summarize strategy', async () => {
    const content = 'a'.repeat(10000);
    const result = await processContext({
      rawContent: content,
      strategy: 'summarize',
      maxTokens: 100,
      summarizeRuntime: mockRuntime,
      summarizeModel: 'test-model',
    });
    expect(result).toBe('这是摘要内容。');
    expect(mockRuntime.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a text summarization assistant.',
        model: 'test-model',
      }),
    );
  });
});
