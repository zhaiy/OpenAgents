import { z } from 'zod';

import type {
  AgentConfig,
  CacheConfig,
  ContextStrategy,
  EvalConfig,
  MCP_toolConfig,
  NotifyConfig,
  OnFailureAction,
  OutputFileConfig,
  PostProcessorErrorMode,
  ProjectConfig,
  RetryConfig,
  RuntimeType,
  ScriptPostProcessorConfig,
  Script_toolConfig,
  SkillConfig,
  SkillDependencies,
  SkillExample,
  SkillMeta,
  SkillPermissions,
  SkillRiskLevel,
  StepConfig,
  StepContextConfig,
  ToolConfig,
  WorkflowConfig,
} from '../types/index.js';
import { validateCommandPolicy } from '../security/command-policy.js';

const idRegex = /^[a-z][a-z0-9_-]*$/;

const RuntimeTypeSchema = z.enum(['llm-direct', 'openclaw', 'opencode', 'claude-code', 'script']) satisfies z.ZodType<RuntimeType>;

const RetryConfigSchema = z.object({
  max_attempts: z.number().int().min(0).default(2),
  delay_seconds: z.number().int().min(0).default(5),
}) satisfies z.ZodType<RetryConfig>;

const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  ttl: z.number().int().min(0).optional(),
  key: z.string().optional(),
}) satisfies z.ZodType<CacheConfig>;

const OnFailureActionSchema = z.enum(['fail', 'skip', 'fallback', 'notify']) satisfies z.ZodType<OnFailureAction>;

const NotifyConfigSchema = z.object({
  webhook: z.string().url().optional(),
}) satisfies z.ZodType<NotifyConfig>;

const PostProcessorErrorModeSchema = z.enum(['fail', 'skip', 'passthrough']) satisfies z.ZodType<PostProcessorErrorMode>;

const ScriptPostProcessorConfigSchema = z.object({
  type: z.literal('script'),
  name: z.string().min(1).optional(),
  command: z.string().min(1),
  timeout_ms: z.number().int().positive().optional(),
  max_output_chars: z.number().int().positive().optional(),
  on_error: PostProcessorErrorModeSchema.optional(),
}).superRefine((config, ctx) => {
  try {
    validateCommandPolicy(config.command);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['command'],
      message: error instanceof Error ? error.message : 'invalid post-processor command',
    });
  }
}) satisfies z.ZodType<ScriptPostProcessorConfig>;

// =============================================================================
// Tool Configuration Schema (used by Skills and Agents)
// =============================================================================

const MCP_toolConfigSchema = z.object({
  type: z.literal('mcp'),
  server: z.string().min(1),
  tool: z.string().min(1),
}) satisfies z.ZodType<MCP_toolConfig>;

const Script_toolConfigSchema = z.object({
  type: z.literal('script'),
  path: z.string().min(1),
  args: z.array(z.string()).optional(),
}) satisfies z.ZodType<Script_toolConfig>;

const ToolConfigSchema: z.ZodType<ToolConfig> = z.union([MCP_toolConfigSchema, Script_toolConfigSchema]);

// =============================================================================
// Skill Configuration Schema (F1: Standardized Skill Specification)
// =============================================================================

const SkillRiskLevelSchema = z.enum(['low', 'medium', 'high']) satisfies z.ZodType<SkillRiskLevel>;

const SkillPermissionsSchema = z.object({
  network: z.boolean().optional(),
  filesystem: z.enum(['none', 'read-only', 'read-write']).optional(),
  environment: z.array(z.string()).optional(),
}) satisfies z.ZodType<SkillPermissions>;

const SkillDependenciesSchema = z.object({
  skills: z.array(z.string()).optional(),
  tools: z.array(ToolConfigSchema).optional(),
}) satisfies z.ZodType<SkillDependencies>;

const SkillExampleSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  output_preview: z.string().optional(),
}) satisfies z.ZodType<SkillExample>;

const SkillMetaSchema = z.object({
  id: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  author: z.string().optional(),
  tags: z.array(z.string()).optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
}) satisfies z.ZodType<SkillMeta>;

export const SkillConfigSchema = z.object({
  skill: SkillMetaSchema,
  instructions: z.string().min(1),
  output_format: z.string().optional(),
  input_schema: z.record(z.string(), z.unknown()).optional(),
  permissions: SkillPermissionsSchema.optional(),
  dependencies: SkillDependenciesSchema.optional(),
  risk_level: SkillRiskLevelSchema.optional(),
  risk_description: z.string().optional(),
  examples: z.array(SkillExampleSchema).optional(),
}) satisfies z.ZodType<SkillConfig>;

const ContextStrategySchema = z.enum(['raw', 'truncate', 'summarize', 'auto']) satisfies z.ZodType<ContextStrategy>;

const StepContextConfigSchema = z.object({
  from: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
  strategy: ContextStrategySchema.default('auto'),
  max_tokens: z.number().int().positive().optional(),
  inject_as: z.enum(['system', 'user']).optional(),
}) satisfies z.ZodType<StepContextConfig>;

const EvalDimensionSchema = z.object({
  name: z.string().min(1),
  weight: z.number().min(0).max(1),
  prompt: z.string().min(1),
}) satisfies z.ZodType<{ name: string; weight: number; prompt: string }>;

const EvalConfigSchema = z.object({
  enabled: z.boolean().default(false),
  type: z.literal('llm-judge').default('llm-judge'),
  judge_model: z.string().optional(),
  dimensions: z.array(EvalDimensionSchema),
}) satisfies z.ZodType<EvalConfig>;

const OutputFileConfigSchema = z.object({
  step: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
  filename: z.string().min(1),
}) satisfies z.ZodType<OutputFileConfig>;

const StepConfigSchemaBase = z.object({
  id: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
  agent: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
  task: z.string().min(1),
  metadata: z
    .object({
      displayName: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  depends_on: z.array(z.string()).optional(),
  gate: z.enum(['auto', 'approve']).optional(),
  retry: RetryConfigSchema.optional(),
  cache: CacheConfigSchema.optional(),
  on_failure: OnFailureActionSchema.optional(),
  fallback_agent: z.string().regex(idRegex).optional(),
  notify: NotifyConfigSchema.optional(),
  post_processors: z.array(ScriptPostProcessorConfigSchema).optional(),
  context: StepContextConfigSchema.optional(),
}).superRefine((step, ctx) => {
  if (step.on_failure === 'fallback' && !step.fallback_agent) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['fallback_agent'],
      message: 'fallback_agent is required when on_failure is "fallback"',
    });
  }
  if (step.on_failure === 'notify' && !step.notify?.webhook) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['notify', 'webhook'],
      message: 'notify.webhook is required when on_failure is "notify"',
    });
  }
});

export const StepConfigSchema = StepConfigSchemaBase satisfies z.ZodType<StepConfig>;

export const AgentConfigSchema = z
  .object({
    agent: z.object({
      id: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
      name: z.string().min(1),
      description: z.string().min(1),
    }),
    prompt: z.object({
      system: z.string().min(1),
    }),
    runtime: z.object({
      type: RuntimeTypeSchema,
      model: z.string().optional(),
      api_key: z.string().optional(),
      api_base_url: z.string().url().optional(),
      timeout_seconds: z.number().int().positive().default(300),
    }),
    script: z
      .object({
        file: z.string().optional(),
        inline: z.string().optional(),
      })
      .optional(),
    skills: z.array(z.string()).optional(),
    tools: z.array(ToolConfigSchema).optional(),
  })
  .superRefine((config, ctx) => {
    if (config.runtime.type === 'script') {
      if (!config.script?.file && !config.script?.inline) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['script'],
          message: 'script agent must have either script.file or script.inline',
        });
      }
    }
  }) satisfies z.ZodType<AgentConfig>;

export const WorkflowConfigSchema = z
  .object({
    workflow: z.object({
      id: z.string().regex(idRegex, 'must start with lowercase letter and only contain a-z, 0-9, _ or -'),
      name: z.string().min(1),
      description: z.string().min(1),
      metadata: z
        .object({
          displayName: z.string().min(1).optional(),
          description: z.string().min(1).optional(),
          tags: z.array(z.string().min(1)).optional(),
        })
        .optional(),
    }),
    steps: z.array(StepConfigSchema).min(1),
    output: z.object({
      directory: z.string().min(1),
      files: z.array(OutputFileConfigSchema).optional(),
    }),
    cache: CacheConfigSchema.optional(),
    eval: EvalConfigSchema.optional(),
  })
  .superRefine((workflow, ctx) => {
    const seen = new Set<string>();
    for (const [index, step] of workflow.steps.entries()) {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'id'],
          message: `duplicate step id: ${step.id}`,
        });
      }
      seen.add(step.id);
    }

    const allStepIds = new Set(workflow.steps.map((step) => step.id));
    for (const [index, step] of workflow.steps.entries()) {
      for (const dependency of step.depends_on ?? []) {
        if (!allStepIds.has(dependency)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['steps', index, 'depends_on'],
            message: `depends_on references unknown step "${dependency}"`,
          });
        }
      }
    }

    // Validate output.files references existing steps
    if (workflow.output.files) {
      for (const [index, fileConfig] of workflow.output.files.entries()) {
        if (!allStepIds.has(fileConfig.step)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['output', 'files', index, 'step'],
            message: `output.files references unknown step "${fileConfig.step}"`,
          });
        }
      }
    }

    // Validate context.from references existing steps
    for (const [index, step] of workflow.steps.entries()) {
      if (step.context?.from && !allStepIds.has(step.context.from)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps', index, 'context', 'from'],
          message: `context.from references unknown step "${step.context.from}"`,
        });
      }
    }
  }) satisfies z.ZodType<WorkflowConfig>;

export const ProjectConfigSchema = z.object({
  version: z.literal('1'),
  runtime: z.object({
    default_type: RuntimeTypeSchema,
    default_model: z.string().min(1),
    api_key: z.string().optional(),
    api_base_url: z.string().url().optional(),
  }),
  retry: RetryConfigSchema,
  output: z.object({
    base_directory: z.string().min(1).default('./output'),
    preview_lines: z.number().int().min(1).default(10),
  }),
  context: z
    .object({
      auto_raw_threshold: z.number().int().positive().default(500),
      auto_truncate_threshold: z.number().int().positive().default(2000),
      summary_model: z.string().optional(),
      summary_api_key: z.string().optional(),
      summary_api_base_url: z.string().url().optional(),
    })
    .optional(),
}) satisfies z.ZodType<ProjectConfig>;
