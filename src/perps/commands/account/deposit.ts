import { Command } from 'commander';
import { getPerpsOutputOptions } from '../../cli/program.js';
import { outputError } from '../../cli/output.js';

export function registerDepositCommand(account: Command): void {
  account
    .command('deposit')
    .description('Deposit funds to perps account (coming soon)')
    .action(async function (this: Command) {
      const outputOpts = getPerpsOutputOptions(this);
      outputError('Deposit is not yet implemented. Coming soon.', outputOpts);
    });
}
