/**
 * Update command - check for and install CLI updates
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { VERSION } from '../../core/constants.js';
import { checkForUpdate, getInstallCommand } from '../../core/update-check.js';

interface ExecErrorLike {
  message?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

function normalizeOutput(value: string | Buffer | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.toString('utf-8');
}

function runCommand(command: string): { success: true } | { success: false; output: string } {
  try {
    const stdout = execSync(command, {
      encoding: 'utf-8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    if (stdout) process.stdout.write(stdout);
    return { success: true };
  } catch (error) {
    const execError = error as ExecErrorLike;
    const stdout = normalizeOutput(execError.stdout);
    const stderr = normalizeOutput(execError.stderr);
    const message = execError.message ?? '';

    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);

    return {
      success: false,
      output: [message, stdout, stderr].filter(Boolean).join('\n'),
    };
  }
}

// ============================================
// Register Update Command
// ============================================

export function registerUpdateCommand(program: Command): void {
  const update = program
    .command('update')
    .description('Check for and install CLI updates');

  // check subcommand
  update
    .command('check')
    .description('Check for available updates')
    .action((_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const result = checkForUpdate(true);
      const installCommand = getInstallCommand(result?.latestVersion);

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: {
            currentVersion: VERSION,
            latestVersion: result?.latestVersion ?? VERSION,
            updateAvailable: result?.updateAvailable ?? false,
            installCommand,
          },
        }, null, 2));
        return;
      }

      if (!result) {
        console.log(chalk.yellow('Could not check for updates (npm registry unavailable or network error).'));
        console.log(chalk.gray(`Current version: ${VERSION}`));
        return;
      }

      if (result.updateAvailable) {
        console.log(chalk.green(`Update available: ${result.currentVersion} → ${result.latestVersion}`));
        console.log(chalk.gray(`Run: ${installCommand}`));
      } else {
        console.log(chalk.green(`Already up to date (v${VERSION})`));
      }
    });

  // install subcommand
  update
    .command('install')
    .description('Install the latest version')
    .action(() => {
      const result = checkForUpdate(true);
      const installCommand = getInstallCommand(result?.latestVersion);

      console.log(chalk.cyan(`Installing latest version from npm registry...`));
      console.log(chalk.gray(`> ${installCommand}\n`));

      const installResult = runCommand(installCommand);
      if (installResult.success) {
        console.log(chalk.green('\nUpdate complete!'));
        return;
      }

      console.error(chalk.red('\nUpdate failed. Try running manually:'));
      console.error(chalk.gray(`  ${installCommand}`));
      process.exit(1);
    });
}
