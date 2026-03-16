import { Command } from 'commander';
import chalk from 'chalk';
import { loadPerpsConfig } from '../lib/config.js';
import { createPerpsContext, type PerpsContext } from './context.js';
import type { PerpsOutputOptions } from '../types.js';
import { registerPerpsCommands } from '../commands/index.js';

export function createPerpsProgram(): Command {
  const perps = new Command('perps')
    .description('Hyperliquid perpetual futures trading')
    .option('--testnet', 'Use testnet instead of mainnet', false)
    .option('-o, --output <format>', 'Output format: text or json', 'text');

  perps.hook('preAction', (thisCommand) => {

    const opts = thisCommand.optsWithGlobals();
    const testnet = opts.testnet ?? false;
    const config = loadPerpsConfig(testnet);
    const context = createPerpsContext(config);

    thisCommand.setOptionValue('_context', context);
    thisCommand.setOptionValue('_outputOpts', {
      json: opts.output === 'json',
    });
    thisCommand.setOptionValue('_startTime', performance.now());
  });

  perps.hook('postAction', (thisCommand) => {
    const outputOpts = getPerpsOutputOptions(thisCommand);
    if (!outputOpts.json) {
      const startTime = thisCommand.getOptionValue('_startTime') as number | undefined;
      if (startTime !== undefined) {
        const duration = performance.now() - startTime;
        console.log(chalk.gray(`Done in ${duration.toFixed(0)}ms`));
      }
    }
  });

  registerPerpsCommands(perps);

  return perps;
}

export function getPerpsContext(command: Command): PerpsContext {
  let current: Command | null = command;
  while (current) {
    const ctx = current.opts()._context as PerpsContext | undefined;
    if (ctx) return ctx;
    current = current.parent;
  }
  throw new Error('Perps context not found');
}

export function getPerpsOutputOptions(command: Command): PerpsOutputOptions {
  let current: Command | null = command;
  while (current) {
    const opts = current.opts()._outputOpts as PerpsOutputOptions | undefined;
    if (opts) return opts;
    current = current.parent;
  }
  return { json: false };
}
