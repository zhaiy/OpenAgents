# OpenAgents v1.0.0 Release Notes

**Release Date: 2026-03-27**

## Overview

OpenAgents v1.0.0 marks the first stable release of the **Agent Orchestration Core**. This release focuses on standardization, security, and external integration capabilities.

## What is OpenAgents

OpenAgents is a workflow orchestration layer that sits on top of various Agent tools, providing:

- DAG-based multi-agent orchestration
- Human-in-the-loop gates
- Resume and recovery capabilities
- Event streaming for external monitoring
- Standardized Skill specification

## New Features

### F1: Standardized Skill Specification

A complete skill specification for cross-tool compatibility:

- Skill metadata (id, name, description, version, author, tags)
- Input/output schema definitions
- Permission declarations (network, filesystem, environment)
- Dependency declarations (skills, tools)
- Risk level assessment
- Usage examples

See [Skill Specification](./docs/SKILL-SPEC.md) for details.

### F2: Preflight Diagnostics

New `doctor` and `preflight` commands for pre-run health checks:

```bash
openagents doctor
openagents preflight
```

Validates:
- Project configuration
- API key configuration
- Workflow and agent references
- Security settings

### F3: Security Boundaries

Enhanced security with default-secure approach:

- **Script Runtime**: VM sandbox with restricted module access
- **Post-processors**: Blocked from shell interpreters
- **Webhooks**: 
  - Private address blocking (SSRF protection)
  - HTTPS enforcement
  - URL whitelist support

See [Security Documentation](./docs/SECURITY.md) for details.

### F4: Event Streaming

New CLI command for external Agent monitoring:

```bash
openagents events stream --run <run_id> --json
```

Features:
- JSONL output format
- Sequence-based ordering
- Resume from specific sequence
- Heartbeat for long-running tasks

See [Event Contract](./docs/EVENT-CONTRACT.md) for details.

## New CLI Commands

| Command | Description |
|---------|-------------|
| `openagents doctor` | Run preflight diagnostics |
| `openagents preflight` | Alias for doctor |
| `openagents events stream` | Stream workflow events |
| `openagents skills list` | List skills |
| `openagents skills show <id>` | Show skill details |

## Environment Variables

New environment variables for security configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAGENTS_ALLOW_PRIVATE_WEBHOOKS` | Allow private address webhooks | `false` |
| `OPENAGENTS_ALLOW_HTTP_WEBHOOKS` | Allow HTTP webhooks | `false` |
| `OPENAGENTS_WEBHOOK_WHITELIST` | Comma-separated allowed domains | - |
| `OPENAGENTS_WEBHOOK_TIMEOUT_MS` | Webhook timeout | `5000` |

## Breaking Changes

None. This is the first stable release.

## Deprecations

None.

## Migration Guide

For users of pre-release versions:

1. Update `project.yaml` to `openagents.yaml` (both supported)
2. Review security settings if using webhooks
3. Update skill configurations to use new schema (optional)

## Known Issues

- Event streaming uses polling for follow mode (not file watching)
- Windows compatibility not fully tested

## Contributors

Thanks to all contributors who made this release possible.

## Next Steps

Future development will focus on:

- Performance optimization
- Additional runtime support
- Enhanced Web UI
- Community skill library

---

For questions or issues, please open a GitHub issue.