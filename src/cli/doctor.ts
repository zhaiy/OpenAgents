import { Command } from 'commander';

import { PreflightService, type PreflightResult, type DiagnosticStatus, type DiagnosticSeverity } from '../app/services/preflight-service.js';

/**
 * Format status with color indicator.
 */
function formatStatus(status: DiagnosticStatus): string {
  const indicators: Record<DiagnosticStatus, string> = {
    ok: '✓',
    warning: '⚠',
    error: '✗',
  };
  return indicators[status];
}

/**
 * Format severity for display.
 */
function formatSeverity(severity: DiagnosticSeverity): string {
  const labels: Record<DiagnosticSeverity, string> = {
    critical: 'CRITICAL',
    high: 'HIGH   ',
    medium: 'MEDIUM ',
    low: 'LOW    ',
  };
  return labels[severity];
}

/**
 * Print diagnostic result in human-readable format.
 */
function printResult(result: PreflightResult): void {
  console.log('');
  console.log('OpenAgents Preflight Diagnostics');
  console.log('═'.repeat(60));
  console.log(`Project: ${result.projectRoot}`);
  console.log(`Time: ${new Date(result.timestamp).toISOString()}`);
  console.log('');

  // Group checks by category
  const categories = ['config', 'runtime', 'workflow', 'agent', 'skill', 'security'] as const;
  const categoryLabels: Record<string, string> = {
    config: 'Configuration',
    runtime: 'Runtime',
    workflow: 'Workflows',
    agent: 'Agents',
    skill: 'Skills',
    security: 'Security',
  };

  for (const category of categories) {
    const checks = result.checks.filter((c) => c.category === category);
    if (checks.length === 0) continue;

    console.log(`\n${categoryLabels[category]}`);
    console.log('─'.repeat(60));

    for (const check of checks) {
      const status = formatStatus(check.status);
      const message = check.message;
      console.log(`  ${status} ${message}`);

      if (check.details) {
        console.log(`      ${check.details}`);
      }
      if (check.suggestion && check.status !== 'ok') {
        console.log(`      → ${check.suggestion}`);
      }
    }
  }

  // Summary
  console.log('');
  console.log('═'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60));
  console.log(`  Total checks: ${result.summary.total}`);
  console.log(`  ✓ Passed: ${result.summary.ok}`);
  console.log(`  ⚠ Warnings: ${result.summary.warnings}`);
  console.log(`  ✗ Errors: ${result.summary.errors}`);
  console.log('');

  // Overall status
  if (result.status === 'ok') {
    console.log('✓ All checks passed. Project is ready to run.');
  } else if (result.status === 'warning') {
    console.log('⚠ Checks passed with warnings. Review the warnings above.');
  } else {
    console.log('✗ Some checks failed. Fix the errors before running.');
    if (result.blockingIssues.length > 0) {
      console.log('');
      console.log('Blocking issues:');
      for (const issue of result.blockingIssues) {
        console.log(`  - ${issue}`);
      }
    }
  }

  console.log('');
}

/**
 * Create the doctor command.
 */
export function createDoctorCommand(): Command {
  const command = new Command('doctor');

  command
    .description('Run preflight diagnostics to check project health')
    .option('--json', 'output as JSON')
    .option('--quiet', 'only show errors and warnings')
    .action((options) => {
      const projectRoot = process.cwd();
      const service = new PreflightService(projectRoot);
      const result = service.runDiagnostics();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.quiet) {
        // Only show non-ok checks
        result.checks = result.checks.filter((c) => c.status !== 'ok');
      }

      printResult(result);

      // Exit with error code if there are errors
      if (result.status === 'error') {
        process.exit(1);
      }
    });

  return command;
}

/**
 * Create the preflight command (alias for doctor).
 */
export function createPreflightCommand(): Command {
  const command = new Command('preflight');

  command
    .description('Run preflight checks before workflow execution (alias for doctor)')
    .option('--json', 'output as JSON')
    .option('--quiet', 'only show errors and warnings')
    .action((options) => {
      const projectRoot = process.cwd();
      const service = new PreflightService(projectRoot);
      const result = service.runDiagnostics();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.quiet) {
        result.checks = result.checks.filter((c) => c.status !== 'ok');
      }

      printResult(result);

      if (result.status === 'error') {
        process.exit(1);
      }
    });

  return command;
}