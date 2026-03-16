/**
 * Byreal Perps CLI - Hyperliquid Perpetual Futures Trading
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { VERSION, CLI_NAME, LOGO, EXPERIMENTAL_WARNING } from './core/constants.js';
import { loadPerpsConfig } from './perps/lib/config.js';
import { createPerpsContext } from './perps/cli/context.js';
import { registerPerpsCommands } from './perps/commands/index.js';
import { printUpdateNotice } from './core/update-check.js';

const program = new Command();

program
  .name(CLI_NAME)
  .description('Byreal Hyperliquid perpetual futures trading')
  .version(VERSION, '-v, --version', 'Output the version number')
  .option('--testnet', 'Use testnet instead of mainnet', false)
  .option('-o, --output <format>', 'Output format: text or json', 'text')
  .option('--debug', 'Show debug information')
  .addHelpText('before', chalk.cyan(LOGO) + chalk.yellow(EXPERIMENTAL_WARNING))
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) {
      process.env.DEBUG = 'true';
    }

    const testnet = opts.testnet ?? false;
    const config = loadPerpsConfig(testnet);
    const context = createPerpsContext(config);

    thisCommand.setOptionValue('_context', context);
    thisCommand.setOptionValue('_outputOpts', {
      json: opts.output === 'json',
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
    if (error instanceof Error) {
      console.error(chalk.red(`\nError: ${error.message}`));
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
    }
    process.exit(1);
  }
}

main();
