import type { AgentConfig, AgentRuntime, ProjectConfig, RuntimeType } from '../types/index.js';
import { LLMDirectRuntime } from './llm-direct.js';
import { ScriptRuntime } from './script.js';

export function createRuntime(
  type: RuntimeType,
  projectConfig: ProjectConfig,
  agentConfig?: AgentConfig,
): AgentRuntime {
  switch (type) {
    case 'llm-direct':
      return new LLMDirectRuntime({
        apiKey: agentConfig?.runtime.api_key ?? projectConfig.runtime.api_key,
        baseUrl: agentConfig?.runtime.api_base_url ?? projectConfig.runtime.api_base_url,
      });
    case 'script':
      return new ScriptRuntime({
        projectRoot: process.cwd(),
        scriptFile: agentConfig?.script?.file,
        scriptInline: agentConfig?.script?.inline,
      });
    default:
      throw new Error(`Unsupported runtime type "${type}" in MVP. Only "llm-direct" and "script" are available.`);
  }
}
