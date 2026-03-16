import type { Command } from 'commander';
import { registerInitCommand } from './init.js';
import { registerInfoCommand } from './info.js';
import { registerDepositCommand } from './deposit.js';
import { registerWithdrawCommand } from './withdraw.js';
import { registerHistoryCommand } from './history.js';

export function registerAccountCommands(perps: Command): void {
  const account = perps
    .command('account')
    .description('Perps account management');

  registerInitCommand(account);
  registerInfoCommand(account);
  registerDepositCommand(account);
  registerWithdrawCommand(account);
  registerHistoryCommand(account);
}
