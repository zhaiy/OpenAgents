import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';

import { SkillConfigSchema } from '../config/schema.js';
import type {
  SkillConfig,
  SkillDependencies,
  SkillExample,
  SkillMeta,
  SkillPermissions,
  SkillRiskLevel,
} from '../types/index.js';

function normalizeVersion(version: unknown): string {
  if (typeof version === 'string') {
    return version;
  }
  if (typeof version === 'number' && Number.isFinite(version)) {
    return Number.isInteger(version) ? version.toFixed(1) : String(version);
  }
  return '1.0.0';
}

/**
 * Parse skill metadata from YAML parsed object.
 */
function parseSkillMeta(skillData: Record<string, unknown>): SkillMeta | undefined {
  const id = skillData.id;
  const name = skillData.name;

  if (!id || typeof id !== 'string' || !name || typeof name !== 'string') {
    return undefined;
  }

  return {
    id: id as string,
    name: name as string,
    description: typeof skillData.description === 'string' ? (skillData.description as string) : '',
    version: normalizeVersion(skillData.version),
    author: typeof skillData.author === 'string' ? (skillData.author as string) : undefined,
    tags: Array.isArray(skillData.tags) ? (skillData.tags as string[]) : undefined,
    homepage: typeof skillData.homepage === 'string' ? (skillData.homepage as string) : undefined,
    repository: typeof skillData.repository === 'string' ? (skillData.repository as string) : undefined,
  };
}

/**
 * Parse skill permissions from YAML parsed object.
 */
function parsePermissions(permissionsData: unknown): SkillPermissions | undefined {
  if (!permissionsData || typeof permissionsData !== 'object') {
    return undefined;
  }

  const perms = permissionsData as Record<string, unknown>;
  return {
    network: typeof perms.network === 'boolean' ? perms.network : undefined,
    filesystem: typeof perms.filesystem === 'string' ? (perms.filesystem as SkillPermissions['filesystem']) : undefined,
    environment: Array.isArray(perms.environment) ? (perms.environment as string[]) : undefined,
  };
}

/**
 * Parse skill dependencies from YAML parsed object.
 */
function parseDependencies(depsData: unknown): SkillDependencies | undefined {
  if (!depsData || typeof depsData !== 'object') {
    return undefined;
  }

  const deps = depsData as Record<string, unknown>;
  return {
    skills: Array.isArray(deps.skills) ? (deps.skills as string[]) : undefined,
    tools: Array.isArray(deps.tools) ? (deps.tools as SkillDependencies['tools']) : undefined,
  };
}

/**
 * Parse skill examples from YAML parsed object.
 */
function parseExamples(examplesData: unknown): SkillExample[] | undefined {
  if (!Array.isArray(examplesData)) {
    return undefined;
  }

  return examplesData.map((ex) => {
    const exRecord = ex as Record<string, unknown>;
    return {
      input: (exRecord.input as Record<string, unknown>) ?? {},
      output_preview: typeof exRecord.output_preview === 'string' ? exRecord.output_preview : undefined,
    };
  });
}

export class SkillsRegistry {
  private skills = new Map<string, SkillConfig>();
  private loadErrors: Array<{ filePath: string; message: string }> = [];

  constructor(private readonly skillsDir: string) {}

  loadAll(): void {
    this.skills = new Map<string, SkillConfig>();
    this.loadErrors = [];

    if (!fs.existsSync(this.skillsDir)) {
      return;
    }

    const files = fs.readdirSync(this.skillsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));

    for (const file of files) {
      const filePath = path.join(this.skillsDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const skill = this.parseSkill(content, filePath);
        if (skill) {
          this.skills.set(skill.skill.id, skill);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.loadErrors.push({ filePath, message });
        console.warn(`Failed to load skill from ${filePath}:`, message);
      }
    }
  }

  get(id: string): SkillConfig | undefined {
    return this.skills.get(id);
  }

  getAll(): SkillConfig[] {
    return Array.from(this.skills.values());
  }

  has(id: string): boolean {
    return this.skills.has(id);
  }

  getLoadErrors(): Array<{ filePath: string; message: string }> {
    return [...this.loadErrors];
  }

  /**
   * Get skills by risk level.
   */
  getByRiskLevel(level: SkillRiskLevel): SkillConfig[] {
    return this.getAll().filter((skill) => (skill.risk_level ?? 'low') === level);
  }

  /**
   * Get skills by tag.
   */
  getByTag(tag: string): SkillConfig[] {
    return this.getAll().filter((skill) => skill.skill.tags?.includes(tag));
  }

  /**
   * Get skills that require network access.
   */
  getRequiringNetwork(): SkillConfig[] {
    return this.getAll().filter((skill) => skill.permissions?.network === true);
  }

  /**
   * Get skills that require filesystem access.
   */
  getRequiringFilesystem(): SkillConfig[] {
    return this.getAll().filter(
      (skill) => skill.permissions?.filesystem && skill.permissions.filesystem !== 'none',
    );
  }

  private parseSkill(content: string, filePath: string): SkillConfig | undefined {
    try {
      const parsed = yaml.load(content) as Record<string, unknown>;

      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }

      const skillData = parsed.skill as Record<string, unknown> | undefined;
      if (!skillData || typeof skillData !== 'object') {
        return undefined;
      }

      const skillMeta = parseSkillMeta(skillData as Record<string, unknown>);
      if (!skillMeta) {
        return undefined;
      }

      const instructions = parsed.instructions;
      const outputFormat = parsed.output_format;
      const inputSchema = parsed.input_schema;
      const riskLevel = typeof parsed.risk_level === 'string' ? (parsed.risk_level as SkillRiskLevel) : undefined;
      const riskDescription = typeof parsed.risk_description === 'string' ? parsed.risk_description : undefined;

      const normalized: SkillConfig = {
        skill: skillMeta,
        instructions: typeof instructions === 'string' ? instructions : '',
        output_format: typeof outputFormat === 'string' ? outputFormat : undefined,
        input_schema: typeof inputSchema === 'object' ? (inputSchema as Record<string, unknown>) : undefined,
        permissions: parsePermissions(parsed.permissions),
        dependencies: parseDependencies(parsed.dependencies),
        risk_level: riskLevel,
        risk_description: riskDescription,
        examples: parseExamples(parsed.examples),
      };

      const validated = SkillConfigSchema.safeParse(normalized);
      if (!validated.success) {
        const message = validated.error.issues
          .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
          .join('; ');
        this.loadErrors.push({ filePath, message });
        console.warn(`Failed to parse skill from ${filePath}:`, message);
        return undefined;
      }

      return validated.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.loadErrors.push({ filePath, message });
      console.warn(`Failed to parse skill from ${filePath}:`, message);
      return undefined;
    }
  }
}

export interface SkillsContext {
  skills: Record<string, { instructions: string; output_format?: string }>;
}

export function buildSkillsContext(skillConfigs: SkillConfig[]): SkillsContext {
  const skills: SkillsContext['skills'] = {};
  for (const skill of skillConfigs) {
    skills[skill.skill.id] = {
      instructions: skill.instructions,
      output_format: skill.output_format,
    };
  }
  return { skills };
}
