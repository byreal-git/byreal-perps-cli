import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';

export function registerHistoryCommand(account: Command): void {
  account
    .command('history')
    .description('Show recent trade history')
    .option('--limit <n>', 'Number of fills to show', '20')
    .action(async function (this: Command, options: { limit: string }) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        const fills = await publicClient.userFills({ user: address });
        const limit = Math.min(parseInt(options.limit, 10) || 20, 100);
        const recentFills = fills.slice(0, limit);

        const displayFills = recentFills.map((f: Record<string, unknown>) => ({
          coin: f.coin,
          side: f.side === 'B' ? 'Buy' : 'Sell',
          size: f.sz,
          price: f.px,
          time: new Date((f.time as number)).toISOString(),
          fee: f.fee,
          oid: f.oid,
        }));

        output(displayFills, outputOpts);
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'ACCOUNT_ERROR');
        process.exit(1);
      }
    });
}
