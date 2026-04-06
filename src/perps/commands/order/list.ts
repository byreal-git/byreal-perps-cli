import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';

export function registerListCommand(order: Command): void {
  order
    .command('list')
    .alias('ls')
    .description('List open orders')
    .action(async function (this: Command) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const publicClient = ctx.getPublicClient();
        const user = ctx.getWalletAddress();

        const [mainOrders, xyzOrders] = await Promise.all([
          publicClient.openOrders({ user }),
          publicClient.openOrders({ user, dex: 'xyz' }),
        ]);

        const formatOrders = (orders: any[], dex: string) =>
          orders.map((o) => ({
            oid: o.oid,
            coin: o.coin,
            dex,
            side: o.side === 'B' ? 'Buy' : 'Sell',
            size: o.sz,
            price: o.limitPx,
            timestamp: o.timestamp ? new Date(o.timestamp).toISOString() : '',
          }));

        const displayOrders = [
          ...formatOrders(mainOrders, 'main'),
          ...formatOrders(xyzOrders, 'xyz'),
        ];

        if (displayOrders.length === 0) {
          if (outputOpts.json) {
            output([], outputOpts);
          } else {
            console.log('No open orders');
          }
          return;
        }

        output(displayOrders, outputOpts);
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'ORDER_LIST_ERROR');
        process.exit(1);
      }
    });
}
