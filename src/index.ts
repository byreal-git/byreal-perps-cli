/**
 * Byreal Perps CLI - Hyperliquid Perpetual Futures Trading
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { VERSION, CLI_NAME, LOGO, EXPERIMENTAL_WARNING } from './core/constants.js';
import { loadPerpsConfig } from './perps/lib/config.js';
import { createPerpsContext } from './perps/cli/context.js';
import { registerPerpsCommands } from './perps/commands/index.js';
import { registerUpdateCommand } from './perps/commands/update.js';
import { printUpdateNotice } from './core/update-check.js';
import { outputError } from './perps/cli/output.js';

const program = new Command();

program
  .name(CLI_NAME)
  .description('Byreal Hyperliquid perpetual futures trading')
  .version(VERSION, '-v, --version', 'Output the version number')
  .option('-o, --output <format>', 'Output format: text or json', 'text')
  .option('-y, --yes', 'Skip all confirmation prompts (auto-confirm)')
  .option('--debug', 'Show debug information')
  .addHelpText('before', chalk.cyan(LOGO) + chalk.yellow(EXPERIMENTAL_WARNING))
  .hook('preAction', (thisCommand, actionCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) {
      process.env.DEBUG = 'true';
    }

    // Skip perps context loading for commands that don't need it
    const rootCmd = actionCommand.parent?.name() ?? actionCommand.name();
    const isJson = opts.output === 'json';
    const autoYes = opts.yes || isJson; // JSON mode always auto-confirms

    if (rootCmd === 'update') {
      thisCommand.setOptionValue('_outputOpts', { json: isJson, yes: autoYes });
      thisCommand.setOptionValue('_startTime', performance.now());
      return;
    }

    const config = loadPerpsConfig();
    const context = createPerpsContext(config);

    thisCommand.setOptionValue('_context', context);
    thisCommand.setOptionValue('_outputOpts', {
      json: isJson,
      yes: autoYes,
    });
    thisCommand.setOptionValue('_startTime', performance.now());
  })
  .hook('postAction', (thisCommand) => {
    const outputOpts = thisCommand.getOptionValue('_outputOpts') as { json: boolean } | undefined;
    if (!outputOpts?.json) {
      const startTime = thisCommand.getOptionValue('_startTime') as number | undefined;
      if (startTime !== undefined) {
        const duration = performance.now() - startTime;
        console.log(chalk.gray(`Done in ${duration.toFixed(0)}ms`));
      }
    }
  });

registerPerpsCommands(program);
registerUpdateCommand(program);

program.showHelpAfterError('(add --help for additional information)');

program.on('command:*', () => {
  console.error(chalk.red(`\nError: Unknown command "${program.args.join(' ')}"`));
  console.log();
  program.outputHelp();
  process.exit(1);
});

async function main() {
  try {
    await program.parseAsync(process.argv);
    const opts = program.opts();
    if (opts.output !== 'json') {
      printUpdateNotice();
    }
  } catch (error) {
    const isJson = process.argv.includes('-o') && process.argv.includes('json')
      || process.argv.includes('--output') && process.argv.includes('json');
    const message = error instanceof Error ? error.message : String(error);

    if (isJson) {
      outputError(message, { json: true }, 'CLI_ERROR');
    } else {
      console.error(chalk.red(`\nError: ${message}`));
      if (process.env.DEBUG) {
        console.error(error instanceof Error ? error.stack : undefined);
      }
    }
    process.exit(1);
  }
}

main();
