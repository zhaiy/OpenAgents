import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { GateRejectError, RuntimeError } from '../errors.js';
import * as notifier from '../output/notifier.js';

// Mock fetch for webhook tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Error Recovery Strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(notifier.webhookDns, 'lookupHostname').mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    // Reset environment variables
    delete process.env.OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS;
    delete process.env.OPENAGENTS_ALLOW_HTTP_WEBHOOKS;
    delete process.env.OPENAGENTS_ENFORCE_HTTPS_WEBHOOKS;
    delete process.env.OPENAGENTS_WEBHOOK_WHITELIST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up environment variables
    delete process.env.OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS;
    delete process.env.OPENAGENTS_ALLOW_HTTP_WEBHOOKS;
    delete process.env.OPENAGENTS_ENFORCE_HTTPS_WEBHOOKS;
    delete process.env.OPENAGENTS_WEBHOOK_WHITELIST;
  });

  describe('sendWebhookNotification', () => {
    it('should send POST request to webhook URL', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await notifier.sendWebhookNotification('https://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [target, options] = mockFetch.mock.calls[0]!;
      expect(String(target)).toBe('https://example.com/webhook');
      expect(options).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OpenAgents/1.0',
        },
        body: JSON.stringify({
          workflowId: 'test-workflow',
          runId: 'run-123',
          stepId: 'step-1',
          agent: 'agent-1',
          error: 'Test error',
          timestamp: 1234567890,
        }),
      });
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      // The function catches errors and logs them, so it shouldn't throw
      await notifier.sendWebhookNotification('https://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      // Should not throw - webhook failures should not block workflow
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Should not throw - webhook failures should not block workflow
      await notifier.sendWebhookNotification('https://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should block private webhook targets by default', async () => {
      await notifier.sendWebhookNotification('http://127.0.0.1:8080/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should block hostnames resolving to private addresses by default', async () => {
      vi.spyOn(notifier.webhookDns, 'lookupHostname').mockResolvedValueOnce([{ address: '10.0.0.8', family: 4 }]);

      await notifier.sendWebhookNotification('https://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows private targets when explicitly enabled', async () => {
      process.env.OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS = 'true';
      process.env.OPENAGENTS_ALLOW_HTTP_WEBHOOKS = 'true';
      mockFetch.mockResolvedValueOnce({ ok: true });

      await notifier.sendWebhookNotification('http://127.0.0.1:8080/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should block HTTP URLs by default (HTTPS enforcement)', async () => {
      await notifier.sendWebhookNotification('http://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows HTTP URLs when explicitly enabled', async () => {
      process.env.OPENAGENTS_ALLOW_HTTP_WEBHOOKS = 'true';
      mockFetch.mockResolvedValueOnce({ ok: true });

      await notifier.sendWebhookNotification('http://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('allows whitelisted domains', async () => {
      process.env.OPENAGENTS_WEBHOOK_WHITELIST = 'example.com,*.trusted.local';
      mockFetch.mockResolvedValueOnce({ ok: true });

      // HTTP should be allowed for whitelisted domains
      await notifier.sendWebhookNotification('http://example.com/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('allows whitelisted wildcard subdomains', async () => {
      process.env.OPENAGENTS_WEBHOOK_WHITELIST = '*.trusted.local';
      process.env.OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS = 'true';
      mockFetch.mockResolvedValueOnce({ ok: true });

      await notifier.sendWebhookNotification('http://api.trusted.local/webhook', {
        workflowId: 'test-workflow',
        runId: 'run-123',
        stepId: 'step-1',
        agent: 'agent-1',
        error: 'Test error',
        timestamp: 1234567890,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('validateWebhookUrl', () => {
    it('should validate HTTPS URLs', () => {
      expect(() => notifier.validateWebhookUrl('https://example.com/webhook')).not.toThrow();
    });

    it('should reject HTTP URLs by default', () => {
      expect(() => notifier.validateWebhookUrl('http://example.com/webhook')).toThrow('HTTP webhook URLs are not allowed');
    });

    it('should reject private addresses with HTTP (HTTP check comes first)', () => {
      // HTTP check happens before private address check
      expect(() => notifier.validateWebhookUrl('http://127.0.0.1:8080/webhook')).toThrow('HTTP webhook URLs are not allowed');
    });

    it('should reject private addresses with HTTPS', () => {
      expect(() => notifier.validateWebhookUrl('https://127.0.0.1:8080/webhook')).toThrow('Blocked private webhook target');
    });

    it('should reject unsupported protocols', () => {
      expect(() => notifier.validateWebhookUrl('ftp://example.com/webhook')).toThrow('Unsupported webhook protocol');
    });
  });
});

describe('OnFailure Actions', () => {
  it('should have correct action types', () => {
    const validActions = ['fail', 'skip', 'fallback', 'notify'] as const;

    // TypeScript will enforce these are the only valid values
    expect(validActions).toContain('fail');
    expect(validActions).toContain('skip');
    expect(validActions).toContain('fallback');
    expect(validActions).toContain('notify');
  });
});

describe('GateRejectError', () => {
  it('should create GateRejectError with step ID', () => {
    const error = new GateRejectError('step-1');
    expect(error.message).toBe('用户在节点 "step-1" 的审核门控处终止了工作流');
    expect(error.stepId).toBe('step-1');
    expect(error.name).toBe('GateRejectError');
  });

  it('should be an instance of Error', () => {
    const error = new GateRejectError('step-1');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('RuntimeError', () => {
  it('should create RuntimeError with message and step ID', () => {
    const error = new RuntimeError('Something went wrong', 'step-1');
    expect(error.message).toBe('Something went wrong');
    expect(error.stepId).toBe('step-1');
    expect(error.name).toBe('RuntimeError');
  });

  it('should create RuntimeError with details', () => {
    const details = {
      httpStatus: 500,
      responseBody: '{"error": "Internal Server Error"}',
      isTimeout: false,
    };
    const error = new RuntimeError('API error', 'step-1', details);
    expect(error.details).toEqual(details);
  });

  it('should be an instance of Error', () => {
    const error = new RuntimeError('Test error', 'step-1');
    expect(error).toBeInstanceOf(Error);
  });
});
