# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

openAgents is a transparent and controllable multi-agent orchestration engine. It executes agent workflows defined as DAGs (Directed Acyclic Graphs) with human-in-the-loop gates, real-time progress UI, and state persistence for resumability.

## Common Commands

```bash
# Development
npm run dev                    # Run CLI via tsx (e.g., npm run dev run <workflow>)
npm run build                  # Compile TypeScript to dist/
npm run lint                   # Run ESLint on src/**/*.ts

# Testing
npm test                       # Run all vitest tests
npm test -- dag.test.ts        # Run single test file
npm test -- --reporter=verbose # Run with verbose output

# CLI Usage (after build or via tsx)
npx tsx src/cli/index.ts --help
npx tsx src/cli/index.ts init [directory]
npx tsx src/cli/index.ts run <workflow_id> --input "..."
npx tsx src/cli/index.ts resume <run_id>
npx tsx src/cli/index.ts validate

# Running with specific language
npx tsx src/cli/index.ts --lang zh run novel_writing --input "..."
```

## Architecture

The codebase follows a 4-layer architecture:

```
Layer 1: CLI (src/cli/*)
- Commands: run, resume, init, validate, runs, agents, workflows
- Entrypoint: src/cli/index.ts using Commander.js

Layer 2: Engine (src/engine/*)
- workflow-engine.ts: Orchestrates workflow execution
- dag.ts: Parses workflow steps into execution plan with parallel groups
- scheduler.ts: Executes steps respecting dependencies and parallelism
- gate.ts: Human-in-the-loop approval/editing before gates
- state.ts: Run state persistence to .state.json
- template.ts: Prompt template rendering with {{variable}} syntax

Layer 3: Runtime (src/runtime/*)
- interface.ts: AgentRuntime contract
- factory.ts: Runtime instantiation
- llm-direct.ts: Direct LLM API implementation (OpenAI-compatible)

Layer 4: Infrastructure (src/config/*, src/output/*, src/ui/*, src/i18n/*)
- config/loader.ts: Loads YAML configs (openagents.yaml, agents/, workflows/)
- config/schema.ts: Zod schemas for config validation
- output/writer.ts: Step output file writing
- output/logger.ts: Event logging to events.jsonl
- ui/progress.ts: Terminal UI with ora, chalk, boxen
- i18n/: Localization (en, zh)
```

## Configuration System

Projects use YAML configuration files:

- `openagents.yaml`: Project-level config (runtime defaults, retry policy, output settings)
- `agents/*.yaml`: Agent definitions (system prompts, runtime type, model)
- `workflows/*.yaml`: Workflow definitions (DAG steps with agent assignments)

Config validation uses Zod schemas in src/config/schema.ts.

## Key Patterns

**Dependency Injection**: The WorkflowEngine receives dependencies via constructor (ConfigLoader, StateManager, runtime factory, etc.)

**State Management**: Run state is persisted to `.state.json` and can be resumed after interruption. Steps track status: pending|running|completed|failed|interrupted|skipped.

**Event Logging**: All workflow events are logged to `events.jsonl` for audit trails.

**Template Variables**: Step prompts support `{{input}}`, `{{runId}}`, `{{runDir}}`, `{{steps.<stepId>.outputFile}}`.

**Runtime Types**: 'llm-direct' (OpenAI-compatible), 'openclaw', 'opencode', 'claude-code' (pluggable).

**Gate Types**: 'auto' (proceed automatically) or 'approve' (require human yes/no/edit).

## Project Structure

```
src/
  cli/          # CLI commands using Commander.js
  engine/       # Core workflow execution engine
  runtime/      # Agent runtime implementations
  config/       # YAML loading and Zod validation
  output/       # File output and event logging
  ui/           # Terminal progress UI
  i18n/         # Internationalization (en/zh)
  types/        # TypeScript interfaces
  __tests__/    # Vitest tests
templates/      # Starter project template for 'init' command
docs/           # PRD-v3.md, TECHNICAL-DESIGN.md
```

## Testing

Tests use Vitest and are co-located in `src/__tests__/`. Tests cover:
- dag.test.ts: DAG parsing and parallel group detection
- scheduler.test.ts: Step scheduling execution order
- gate.test.ts: Gate approval/reject/edit logic
- state.test.ts: State persistence and run ID generation
- template.test.ts: Template variable substitution
- loader.test.ts: Config loading and validation
- schema.test.ts: Zod schema validation
- runtime-factory.test.ts: Runtime instantiation
- llm-direct.test.ts: LLM direct runtime (mocked)

## TypeScript Configuration

- Target: ES2022
- Module: Node16 with Node16 resolution
- Strict mode enabled
- Declaration files emitted
- Source maps enabled
- Output: dist/

## Environment Variables

- `OPENAGENTS_API_KEY`: API key for LLM runtime
- `OPENAGENTS_LANG`: Default language (en/zh)
- `OPENAGENTS_API_BASE_URL`: Custom API base URL for LLM
