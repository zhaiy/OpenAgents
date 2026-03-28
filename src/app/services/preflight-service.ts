/**
 * Preflight diagnostic service for run-time health checks.
 *
 * Performs pre-execution validation to catch configuration issues
 * before running a workflow.
 *
 * @see docs/future/NEXT-ITERATION-TASKS.md F2
 */

import fs from 'node:fs';
import path from 'node:path';

import { ConfigLoader } from '../../config/loader.js';
import type { AgentConfig, ProjectConfig, WorkflowConfig } from '../../types/index.js';
import { SkillsRegistry } from '../../skills/registry.js';
import { validateWebhookUrl } from '../../output/notifier.js';

/**
 * Diagnostic check status.
 */
export type DiagnosticStatus = 'ok' | 'warning' | 'error';

/**
 * Severity level for sorting and display.
 */
export type DiagnosticSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Single diagnostic check result.
 */
export interface DiagnosticCheck {
  /** Check identifier */
  id: string;
  /** Check category */
  category: 'config' | 'runtime' | 'workflow' | 'agent' | 'skill' | 'security';
  /** Check status */
  status: DiagnosticStatus;
  /** Severity for prioritization */
  severity: DiagnosticSeverity;
  /** Human-readable message */
  message: string;
  /** Detailed description */
  details?: string;
  /** Suggested fix */
  suggestion?: string;
  /** Related file or resource */
  location?: string;
}

/**
 * Complete preflight diagnostic result.
 */
export interface PreflightResult {
  /** Overall status */
  status: DiagnosticStatus;
  /** Timestamp of the check */
  timestamp: number;
  /** Project root path */
  projectRoot: string;
  /** All diagnostic checks */
  checks: DiagnosticCheck[];
  /** Summary counts */
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
  };
  /** Whether the project is runnable */
  runnable: boolean;
  /** Blocking issues that prevent execution */
  blockingIssues: string[];
}

/**
 * Preflight diagnostic service.
 */
export class PreflightService {
  private readonly configLoader: ConfigLoader;
  private readonly skillsRegistry: SkillsRegistry;
  private cachedAgents?: Map<string, AgentConfig>;
  private cachedWorkflows?: Map<string, WorkflowConfig>;

  constructor(private readonly projectRoot: string) {
    this.configLoader = new ConfigLoader(projectRoot);
    this.skillsRegistry = new SkillsRegistry(path.join(projectRoot, 'skills'));
  }

  /**
   * Run all preflight diagnostics.
   */
  runDiagnostics(): PreflightResult {
    const checks: DiagnosticCheck[] = [];

    // Run all check categories
    checks.push(...this.checkProjectConfig());
    checks.push(...this.checkRuntimeConfig());
    checks.push(...this.checkWorkflows());
    checks.push(...this.checkAgents());
    checks.push(...this.checkSkills());
    checks.push(...this.checkSecurity());

    // Calculate summary
    const summary = {
      total: checks.length,
      ok: checks.filter((c) => c.status === 'ok').length,
      warnings: checks.filter((c) => c.status === 'warning').length,
      errors: checks.filter((c) => c.status === 'error').length,
    };

    // Determine overall status
    let status: DiagnosticStatus = 'ok';
    if (summary.errors > 0) {
      status = 'error';
    } else if (summary.warnings > 0) {
      status = 'warning';
    }

    // Find blocking issues
    const blockingIssues = checks
      .filter((c) => c.status === 'error' && c.severity === 'critical')
      .map((c) => c.message);

    // Determine if runnable
    const runnable = blockingIssues.length === 0;

    return {
      status,
      timestamp: Date.now(),
      projectRoot: this.projectRoot,
      checks,
      summary,
      runnable,
      blockingIssues,
    };
  }

  /**
   * Check project configuration.
   */
  private checkProjectConfig(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    // Check openagents.yaml exists (new config file name)
    const projectPath = path.join(this.projectRoot, 'openagents.yaml');
    const legacyProjectPath = path.join(this.projectRoot, 'project.yaml');
    
    if (!fs.existsSync(projectPath) && !fs.existsSync(legacyProjectPath)) {
      checks.push({
        id: 'project-config-missing',
        category: 'config',
        status: 'error',
        severity: 'critical',
        message: 'openagents.yaml not found',
        details: 'Project configuration file is required to run workflows.',
        suggestion: 'Run "openagents init" to create a new project.',
        location: projectPath,
      });
      return checks;
    }

    const configPath = fs.existsSync(projectPath) ? projectPath : legacyProjectPath;
    checks.push({
      id: 'project-config-exists',
      category: 'config',
      status: 'ok',
      severity: 'low',
      message: `${path.basename(configPath)} found`,
      location: configPath,
    });

    // Validate project config
    try {
      const projectConfig = this.configLoader.loadProjectConfig();

      // Check runtime type
      const validRuntimeTypes = ['llm-direct', 'openclaw', 'opencode', 'claude-code', 'script'];
      if (!validRuntimeTypes.includes(projectConfig.runtime.default_type)) {
        checks.push({
          id: 'project-runtime-invalid',
          category: 'config',
          status: 'error',
          severity: 'high',
          message: `Invalid runtime type: ${projectConfig.runtime.default_type}`,
          suggestion: `Valid types: ${validRuntimeTypes.join(', ')}`,
        });
      } else {
        checks.push({
          id: 'project-runtime-valid',
          category: 'config',
          status: 'ok',
          severity: 'low',
          message: `Runtime type: ${projectConfig.runtime.default_type}`,
        });
      }

      // Check default model
      if (!projectConfig.runtime.default_model) {
        checks.push({
          id: 'project-model-missing',
          category: 'config',
          status: 'warning',
          severity: 'medium',
          message: 'No default model specified',
          suggestion: 'Add runtime.default_model to openagents.yaml',
        });
      } else {
        checks.push({
          id: 'project-model-set',
          category: 'config',
          status: 'ok',
          severity: 'low',
          message: `Default model: ${projectConfig.runtime.default_model}`,
        });
      }
    } catch (error) {
      checks.push({
        id: 'project-config-invalid',
        category: 'config',
        status: 'error',
        severity: 'critical',
        message: 'Invalid project configuration',
        details: error instanceof Error ? error.message : 'Unknown error',
        suggestion: 'Check the YAML syntax and schema.',
        location: configPath,
      });
    }

    return checks;
  }

  /**
   * Check runtime configuration.
   */
  private checkRuntimeConfig(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    try {
      const projectConfig = this.configLoader.loadProjectConfig();

      // Check API key configuration
      const apiKey = projectConfig.runtime.api_key || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        checks.push({
          id: 'runtime-api-key-missing',
          category: 'runtime',
          status: 'warning',
          severity: 'medium',
          message: 'No API key configured',
          details: 'Set runtime.api_key in openagents.yaml or OPENAI_API_KEY environment variable.',
          suggestion: 'Add your API key to openagents.yaml or set the environment variable.',
        });
      } else {
        // Check API key format (basic validation)
        const keyLength = apiKey.length;
        if (keyLength < 10) {
          checks.push({
            id: 'runtime-api-key-invalid',
            category: 'runtime',
            status: 'warning',
            severity: 'medium',
            message: 'API key appears to be too short',
            suggestion: 'Verify your API key is correct.',
          });
        } else {
          checks.push({
            id: 'runtime-api-key-set',
            category: 'runtime',
            status: 'ok',
            severity: 'low',
            message: 'API key configured',
          });
        }
      }

      // Check API base URL if specified
      if (projectConfig.runtime.api_base_url) {
        try {
          new URL(projectConfig.runtime.api_base_url);
          checks.push({
            id: 'runtime-api-url-valid',
            category: 'runtime',
            status: 'ok',
            severity: 'low',
            message: `API base URL: ${projectConfig.runtime.api_base_url}`,
          });
        } catch {
          checks.push({
            id: 'runtime-api-url-invalid',
            category: 'runtime',
            status: 'error',
            severity: 'high',
            message: 'Invalid API base URL',
            details: projectConfig.runtime.api_base_url,
            suggestion: 'Provide a valid URL (e.g., https://api.openai.com/v1)',
          });
        }
      }
    } catch {
      // Project config errors are handled in checkProjectConfig
    }

    return checks;
  }

  /**
   * Check workflow configurations.
   */
  private checkWorkflows(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    const workflowsDir = path.join(this.projectRoot, 'workflows');
    if (!fs.existsSync(workflowsDir)) {
      checks.push({
        id: 'workflows-dir-missing',
        category: 'workflow',
        status: 'warning',
        severity: 'medium',
        message: 'workflows/ directory not found',
        suggestion: 'Create workflows/ directory and add workflow YAML files.',
        location: workflowsDir,
      });
      return checks;
    }

    const workflowFiles = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    if (workflowFiles.length === 0) {
      checks.push({
        id: 'workflows-empty',
        category: 'workflow',
        status: 'warning',
        severity: 'medium',
        message: 'No workflow files found',
        suggestion: 'Add workflow YAML files to workflows/ directory.',
        location: workflowsDir,
      });
      return checks;
    }

    checks.push({
      id: 'workflows-found',
      category: 'workflow',
      status: 'ok',
      severity: 'low',
      message: `Found ${workflowFiles.length} workflow(s)`,
      location: workflowsDir,
    });

    // Load all workflows
    try {
      this.cachedWorkflows = this.configLoader.loadWorkflows();
      
      // Validate each workflow
      for (const [workflowId, workflowConfig] of this.cachedWorkflows) {
        checks.push(...this.validateWorkflowConfig(workflowConfig));
      }
    } catch (error) {
      checks.push({
        id: 'workflows-load-error',
        category: 'workflow',
        status: 'error',
        severity: 'high',
        message: 'Failed to load workflows',
        details: error instanceof Error ? error.message : 'Unknown error',
        location: workflowsDir,
      });
    }

    return checks;
  }

  /**
   * Validate a single workflow configuration.
   */
  private validateWorkflowConfig(workflow: WorkflowConfig): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    // Check steps exist
    if (workflow.steps.length === 0) {
      checks.push({
        id: `workflow-no-steps-${workflow.workflow.id}`,
        category: 'workflow',
        status: 'error',
        severity: 'high',
        message: `Workflow "${workflow.workflow.id}" has no steps`,
        suggestion: 'Add at least one step to the workflow.',
      });
      return checks;
    }

    // Check for circular dependencies
    const stepIds = new Set(workflow.steps.map((s) => s.id));

    // Check for missing dependencies
    for (const step of workflow.steps) {
      for (const dep of step.depends_on ?? []) {
        if (!stepIds.has(dep)) {
          checks.push({
            id: `workflow-missing-dep-${workflow.workflow.id}-${step.id}`,
            category: 'workflow',
            status: 'error',
            severity: 'high',
            message: `Step "${step.id}" depends on non-existent step "${dep}"`,
            location: `workflow: ${workflow.workflow.id}`,
          });
        }
      }
    }

    // Check for high-risk configurations
    for (const step of workflow.steps) {
      if (step.post_processors && step.post_processors.length > 0) {
        checks.push({
          id: `workflow-post-processor-${workflow.workflow.id}-${step.id}`,
          category: 'security',
          status: 'warning',
          severity: 'medium',
          message: `Step "${step.id}" uses post-processors`,
          details: 'Post-processors can execute arbitrary commands. Review the configuration.',
          location: `workflow: ${workflow.workflow.id}, step: ${step.id}`,
        });
      }

      if (step.notify?.webhook) {
        try {
          validateWebhookUrl(step.notify.webhook);
          checks.push({
            id: `workflow-webhook-${workflow.workflow.id}-${step.id}`,
            category: 'security',
            status: 'warning',
            severity: 'low',
            message: `Step "${step.id}" has webhook notification`,
            location: `workflow: ${workflow.workflow.id}, step: ${step.id}`,
          });
        } catch (error) {
          checks.push({
            id: `workflow-webhook-invalid-${workflow.workflow.id}-${step.id}`,
            category: 'security',
            status: 'error',
            severity: 'high',
            message: `Step "${step.id}" has invalid webhook configuration`,
            details: error instanceof Error ? error.message : 'Invalid webhook URL',
            location: `workflow: ${workflow.workflow.id}, step: ${step.id}`,
          });
        }
      }
    }

    return checks;
  }

  /**
   * Check agent configurations.
   */
  private checkAgents(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    const agentsDir = path.join(this.projectRoot, 'agents');
    if (!fs.existsSync(agentsDir)) {
      checks.push({
        id: 'agents-dir-missing',
        category: 'agent',
        status: 'warning',
        severity: 'medium',
        message: 'agents/ directory not found',
        suggestion: 'Create agents/ directory and add agent YAML files.',
        location: agentsDir,
      });
      return checks;
    }

    const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    if (agentFiles.length === 0) {
      checks.push({
        id: 'agents-empty',
        category: 'agent',
        status: 'warning',
        severity: 'medium',
        message: 'No agent files found',
        suggestion: 'Add agent YAML files to agents/ directory.',
        location: agentsDir,
      });
      return checks;
    }

    checks.push({
      id: 'agents-found',
      category: 'agent',
      status: 'ok',
      severity: 'low',
      message: `Found ${agentFiles.length} agent(s)`,
      location: agentsDir,
    });

    // Load all agents
    try {
      this.cachedAgents = this.configLoader.loadAgents();
      
      // Validate each agent
      for (const [agentId, agentConfig] of this.cachedAgents) {
        checks.push(...this.validateAgentConfig(agentConfig));
      }
    } catch (error) {
      checks.push({
        id: 'agents-load-error',
        category: 'agent',
        status: 'error',
        severity: 'high',
        message: 'Failed to load agents',
        details: error instanceof Error ? error.message : 'Unknown error',
        location: agentsDir,
      });
    }

    return checks;
  }

  /**
   * Validate a single agent configuration.
   */
  private validateAgentConfig(agent: AgentConfig): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    // Check for script runtime
    if (agent.runtime.type === 'script') {
      if (!agent.script?.file && !agent.script?.inline) {
        checks.push({
          id: `agent-script-missing-${agent.agent.id}`,
          category: 'agent',
          status: 'error',
          severity: 'high',
          message: `Script agent "${agent.agent.id}" has no script configured`,
          suggestion: 'Add script.file or script.inline to the agent configuration.',
        });
      } else {
        checks.push({
          id: `agent-script-configured-${agent.agent.id}`,
          category: 'agent',
          status: 'ok',
          severity: 'low',
          message: `Script agent "${agent.agent.id}" configured`,
        });
      }
    }

    // Check for skills references
    if (agent.skills && agent.skills.length > 0) {
      this.skillsRegistry.loadAll();
      for (const skillId of agent.skills) {
        if (!this.skillsRegistry.has(skillId)) {
          checks.push({
            id: `agent-skill-missing-${agent.agent.id}-${skillId}`,
            category: 'skill',
            status: 'warning',
            severity: 'medium',
            message: `Agent "${agent.agent.id}" references missing skill "${skillId}"`,
            suggestion: `Create skill file: skills/${skillId}.yaml`,
          });
        }
      }
    }

    return checks;
  }

  /**
   * Check skill configurations.
   */
  private checkSkills(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    const skillsDir = path.join(this.projectRoot, 'skills');
    if (!fs.existsSync(skillsDir)) {
      // Skills are optional
      checks.push({
        id: 'skills-dir-missing',
        category: 'skill',
        status: 'ok',
        severity: 'low',
        message: 'No skills directory (skills are optional)',
        location: skillsDir,
      });
      return checks;
    }

    this.skillsRegistry.loadAll();
    for (const loadError of this.skillsRegistry.getLoadErrors()) {
      checks.push({
        id: `skill-invalid-${path.basename(loadError.filePath)}`,
        category: 'skill',
        status: 'error',
        severity: 'high',
        message: `Invalid skill definition: ${path.basename(loadError.filePath)}`,
        details: loadError.message,
        location: loadError.filePath,
      });
    }

    const skills = this.skillsRegistry.getAll();

    if (skills.length === 0) {
      checks.push({
        id: 'skills-empty',
        category: 'skill',
        status: 'ok',
        severity: 'low',
        message: 'No skills configured (skills are optional)',
        location: skillsDir,
      });
      return checks;
    }

    checks.push({
      id: 'skills-found',
      category: 'skill',
      status: 'ok',
      severity: 'low',
      message: `Found ${skills.length} skill(s)`,
      location: skillsDir,
    });

    // Check for high-risk skills
    const highRiskSkills = skills.filter((s) => s.risk_level === 'high');
    if (highRiskSkills.length > 0) {
      checks.push({
        id: 'skills-high-risk',
        category: 'security',
        status: 'warning',
        severity: 'medium',
        message: `${highRiskSkills.length} skill(s) with high risk level`,
        details: highRiskSkills.map((s) => s.skill.id).join(', '),
        suggestion: 'Review the risk_description field for each high-risk skill.',
      });
    }

    return checks;
  }

  /**
   * Check security configurations.
   */
  private checkSecurity(): DiagnosticCheck[] {
    const checks: DiagnosticCheck[] = [];

    // Check for sensitive environment variables exposure
    const sensitiveEnvVars = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'API_KEY'];
    const exposedVars: string[] = [];

    for (const varName of sensitiveEnvVars) {
      if (process.env[varName]) {
        exposedVars.push(varName);
      }
    }

    if (exposedVars.length > 0) {
      checks.push({
        id: 'security-env-vars',
        category: 'security',
        status: 'ok',
        severity: 'low',
        message: `${exposedVars.length} sensitive environment variable(s) set`,
        details: 'These will be used for API authentication.',
      });
    }

    // Check for private webhook allowance
    if (process.env.OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS === 'true') {
      checks.push({
        id: 'security-private-webhooks',
        category: 'security',
        status: 'warning',
        severity: 'medium',
        message: 'Private webhooks are allowed',
        details: 'OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS=true',
        suggestion: 'Only enable this in development environments.',
      });
    }

    // Check for HTTP webhooks allowance
    if (process.env.OPENAGENTS_ALLOW_HTTP_WEBHOOKS === 'true') {
      checks.push({
        id: 'security-http-webhooks',
        category: 'security',
        status: 'warning',
        severity: 'medium',
        message: 'HTTP webhooks are allowed',
        details: 'OPENAGENTS_ALLOW_HTTP_WEBHOOKS=true',
        suggestion: 'Use HTTPS in production for security.',
      });
    }

    return checks;
  }
}
