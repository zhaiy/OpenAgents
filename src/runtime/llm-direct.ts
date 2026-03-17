import { RuntimeError } from '../errors.js';
import type { AgentRuntime, ExecuteParams, ExecuteResult } from '../types/index.js';

const DEFAULT_BASE_URL = '';

interface LLMDirectRuntimeConfig {
  apiKey?: string;
  baseUrl?: string;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

function normalizeResponseBody(text: string): string {
  if (!text) {
    return '';
  }
  return text.length > 4000 ? `${text.slice(0, 4000)}...(truncated)` : text;
}

export class LLMDirectRuntime implements AgentRuntime {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: LLMDirectRuntimeConfig) {
    const apiKey = process.env.OPENAGENTS_API_KEY || config.apiKey;
    if (!apiKey) {
      throw new RuntimeError(
        'Missing API key. Please set OPENAGENTS_API_KEY or runtime.api_key in openagents.yaml',
        'runtime',
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = process.env.OPENAGENTS_API_BASE_URL || config.baseUrl || DEFAULT_BASE_URL;
  }

  async execute(params: ExecuteParams): Promise<ExecuteResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = params.timeoutSeconds * 1000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Resolve API URL: use baseUrl directly if it already contains /chat/completions
    const url = this.baseUrl ;
    // .includes('/chat/completions')
    //   ? this.baseUrl
    //   : `${this.baseUrl}/v1/chat/completions`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: params.model,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        }),
      });

      const rawText = await response.text();
      let json: OpenAIChatCompletionResponse | undefined;
      try {
        json = rawText ? (JSON.parse(rawText) as OpenAIChatCompletionResponse) : undefined;
      } catch {
        json = undefined;
      }

      if (!response.ok) {
        const detail = json?.error?.message || `HTTP ${response.status}`;
        throw new RuntimeError(`LLM request failed: ${detail}`, 'runtime', {
          httpStatus: response.status,
          responseBody: normalizeResponseBody(rawText),
        });
      }

      const output = json?.choices?.[0]?.message?.content;
      if (!output) {
        throw new RuntimeError('LLM response does not contain choices[0].message.content', 'runtime', {
          httpStatus: response.status,
          responseBody: normalizeResponseBody(rawText),
        });
      }

      return {
        output,
        tokensUsed: json?.usage?.total_tokens,
        tokenUsage: json?.usage
          ? {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens ?? 0,
            }
          : undefined,
        duration: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof RuntimeError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RuntimeError(`LLM request timed out after ${params.timeoutSeconds}s`, 'runtime', {
          isTimeout: true,
          timeoutSeconds: params.timeoutSeconds,
        });
      }
      throw new RuntimeError(error instanceof Error ? error.message : 'unknown runtime error', 'runtime', {
        cause: error instanceof Error ? error.message : 'unknown runtime error',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
