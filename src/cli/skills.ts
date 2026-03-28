import { Command } from 'commander';

import { ConfigLoader } from '../config/loader.js';
import { SkillsRegistry } from '../skills/registry.js';
import type { SkillConfig, SkillRiskLevel } from '../types/index.js';

/**
 * Format risk level with color indicator.
 */
function formatRiskLevel(level?: SkillRiskLevel): string {
  const actualLevel = level ?? 'low';
  const indicators: Record<SkillRiskLevel, string> = {
    low: 'low    ',
    medium: 'medium ',
    high: 'high   ',
  };
  return indicators[actualLevel];
}

/**
 * Format permissions summary.
 */
function formatPermissions(skill: SkillConfig): string {
  const perms: string[] = [];
  if (skill.permissions?.network) {
    perms.push('network');
  }
  if (skill.permissions?.filesystem && skill.permissions.filesystem !== 'none') {
    perms.push(`fs:${skill.permissions.filesystem}`);
  }
  if (skill.permissions?.environment?.length) {
    perms.push(`env:${skill.permissions.environment.length}`);
  }
  return perms.length > 0 ? perms.join(', ') : 'none';
}

/**
 * Create the skills command.
 */
export function createSkillsCommand(): Command {
  const command = new Command('skills');

  command
    .description('Manage and inspect skills')
    .argument('[subcommand]', 'subcommand: list, show')
    .argument('[skill-id]', 'skill ID for show subcommand')
    .option('--json', 'output as JSON')
    .option('--tag <tag>', 'filter by tag')
    .option('--risk <level>', 'filter by risk level (low, medium, high)')
    .action((subcommand, skillId, options) => {
      const projectRoot = process.cwd();
      const configLoader = new ConfigLoader(projectRoot);
      const skillsDir = path.resolve(projectRoot, 'skills');
      const registry = new SkillsRegistry(skillsDir);
      registry.loadAll();

      let skills = registry.getAll();

      // Apply filters
      if (options.tag) {
        skills = skills.filter((s) => s.skill.tags?.includes(options.tag));
      }
      if (options.risk) {
        skills = skills.filter((s) => (s.risk_level ?? 'low') === options.risk);
      }

      // Handle subcommands
      if (subcommand === 'show') {
        if (!skillId) {
          console.error('Error: skill-id is required for show subcommand');
          process.exit(1);
        }
        showSkill(registry, skillId, options.json);
        return;
      }

      // Default: list skills
      listSkills(skills, options.json);
    });

  return command;
}

import path from 'node:path';

/**
 * List all skills.
 */
function listSkills(skills: SkillConfig[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  if (skills.length === 0) {
    console.log('No skills found.');
    console.log('');
    console.log('Create a skill by adding a YAML file to the skills/ directory.');
    console.log('See docs/SKILL-SPEC.md for the skill specification.');
    return;
  }

  console.log('');
  console.log('SKILLS');
  console.log('─'.repeat(80));
  console.log('ID                  NAME                    VERSION   RISK     PERMISSIONS');
  console.log('─'.repeat(80));

  for (const skill of skills) {
    const id = skill.skill.id.padEnd(18);
    const name = skill.skill.name.slice(0, 22).padEnd(22);
    const version = skill.skill.version.padEnd(8);
    const risk = formatRiskLevel(skill.risk_level);
    const perms = formatPermissions(skill);
    console.log(`${id} ${name} ${version} ${risk} ${perms}`);
  }

  console.log('');
  console.log(`Total: ${skills.length} skill(s)`);
  console.log('');
  console.log('Run "openagents skills show <skill-id>" for details.');
}

/**
 * Show detailed information about a skill.
 */
function showSkill(registry: SkillsRegistry, skillId: string, json: boolean): void {
  const skill = registry.get(skillId);

  if (!skill) {
    console.error(`Error: Skill "${skillId}" not found.`);
    console.log('');
    console.log('Available skills:');
    for (const s of registry.getAll()) {
      console.log(`  - ${s.skill.id}`);
    }
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(skill, null, 2));
    return;
  }

  console.log('');
  console.log(`SKILL: ${skill.skill.name}`);
  console.log('─'.repeat(60));
  console.log(`ID:          ${skill.skill.id}`);
  console.log(`Version:     ${skill.skill.version}`);
  console.log(`Author:      ${skill.skill.author ?? 'N/A'}`);
  console.log(`Risk Level:  ${skill.risk_level ?? 'low'}`);
  console.log('');
  console.log('DESCRIPTION');
  console.log(skill.skill.description);
  console.log('');

  if (skill.skill.tags?.length) {
    console.log(`TAGS: ${skill.skill.tags.join(', ')}`);
    console.log('');
  }

  if (skill.permissions) {
    console.log('PERMISSIONS');
    console.log(`  Network:    ${skill.permissions.network ? 'required' : 'none'}`);
    console.log(`  Filesystem: ${skill.permissions.filesystem ?? 'none'}`);
    if (skill.permissions.environment?.length) {
      console.log(`  Environment: ${skill.permissions.environment.join(', ')}`);
    }
    console.log('');
  }

  if (skill.dependencies) {
    console.log('DEPENDENCIES');
    if (skill.dependencies.skills?.length) {
      console.log(`  Skills: ${skill.dependencies.skills.join(', ')}`);
    }
    if (skill.dependencies.tools?.length) {
      console.log(`  Tools: ${skill.dependencies.tools.length} tool(s)`);
    }
    console.log('');
  }

  if (skill.risk_description) {
    console.log('RISK DESCRIPTION');
    console.log(skill.risk_description);
    console.log('');
  }

  console.log('INSTRUCTIONS');
  console.log('─'.repeat(60));
  console.log(skill.instructions.slice(0, 500) + (skill.instructions.length > 500 ? '...' : ''));
  console.log('');

  if (skill.output_format) {
    console.log('OUTPUT FORMAT');
    console.log('─'.repeat(60));
    console.log(skill.output_format.slice(0, 300) + (skill.output_format.length > 300 ? '...' : ''));
    console.log('');
  }

  if (skill.examples?.length) {
    console.log(`EXAMPLES (${skill.examples.length})`);
    console.log('─'.repeat(60));
    for (let i = 0; i < Math.min(skill.examples.length, 2); i++) {
      const example = skill.examples[i];
      console.log(`Example ${i + 1}:`);
      console.log(`  Input: ${JSON.stringify(example.input)}`);
      if (example.output_preview) {
        console.log(`  Output: ${example.output_preview.slice(0, 100)}...`);
      }
    }
    console.log('');
  }
}