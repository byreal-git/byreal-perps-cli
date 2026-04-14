import type { Command } from 'commander';
import { registerInitCommand } from './init.js';
import { registerInfoCommand } from './info.js';
import { registerHistoryCommand } from './history.js';

export function registerAccountCommands(perps: Command): void {
  const account = perps
    .command('account')
    .description('Perps account management');

  registerInitCommand(account);
  registerInfoCommand(account);
  registerHistoryCommand(account);
}
