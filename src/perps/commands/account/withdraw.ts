import { Command } from 'commander';
import { getPerpsOutputOptions } from '../../cli/program.js';
import { outputError } from '../../cli/output.js';

export function registerWithdrawCommand(account: Command): void {
  account
    .command('withdraw')
    .description('Withdraw funds from perps account (coming soon)')
    .action(async function (this: Command) {
      const outputOpts = getPerpsOutputOptions(this);
      outputError('Withdraw is not yet implemented. Coming soon.', outputOpts);
    });
}
