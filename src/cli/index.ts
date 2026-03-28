#!/usr/bin/env node

import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load .env files with priority: .env.local > .env.{NODE_ENV} > .env
// dotenv does not override existing environment variables by default
const envFiles = ['.env.local', `.env.${process.env.NODE_ENV || 'development'}`, '.env'];
for (const file of envFiles) {
  loadEnv({ path: path.resolve(process.cwd(), file) });
}

import { Command } from 'commander';

import { getDefaultLocale, resolveLocale, t } from '../i18n/index.js';
import { createResumeCommand } from './resume.js';
import { createRunCommand } from './run.js';
import { createRunsCommand } from './runs.js';
import { createInitCommand } from './init.js';
import { createValidateCommand } from './validate.js';
import { createAgentsCommand } from './agents.js';
import { createWorkflowsCommand } from './workflows.js';
import { createDebugCommand } from './debug.js';
import { createDagCommand } from './dag.js';
import { createCacheCommand } from './cache.js';
import { createEvalCommand } from './eval.js';
import { createAnalyzeCommand } from './analyze.js';
import { createWebCommand } from './web.js';
import { createSkillsCommand } from './skills.js';
import { createDoctorCommand, createPreflightCommand } from './doctor.js';
import { createEventsCommand } from './events.js';

const program = new Command();

const defaultLocale = getDefaultLocale();

program
  .name('openagents')
  .description(t(defaultLocale, 'cliDescription'))
  .version('0.1.0')
  .option('--lang <locale>', t(defaultLocale, 'langOption'), (value: string) => resolveLocale(value), defaultLocale);

program.addCommand(createRunCommand());
program.addCommand(createResumeCommand());
program.addCommand(createRunsCommand());
program.addCommand(createEvalCommand());
program.addCommand(createAnalyzeCommand());
program.addCommand(createInitCommand());
program.addCommand(createValidateCommand());
program.addCommand(createDoctorCommand());
program.addCommand(createPreflightCommand());
program.addCommand(createAgentsCommand());
program.addCommand(createWorkflowsCommand());
program.addCommand(createSkillsCommand());
program.addCommand(createEventsCommand());
program.addCommand(createDebugCommand());
program.addCommand(createDagCommand());
program.addCommand(createCacheCommand());
program.addCommand(createWebCommand());

program.parse();
