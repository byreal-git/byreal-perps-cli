import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { getAllAssetInfo } from './shared.js';

export function registerCancelAllCommand(order: Command): void {
  order
    .command('cancel-all')
    .description('Cancel all open orders')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function (
      this: Command,
      options: { yes?: boolean },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const user = ctx.getWalletAddress();

        const [mainOrders, xyzOrders] = await Promise.all([
          publicClient.openOrders({ user }),
          publicClient.openOrders({ user, dex: 'xyz' }),
        ]);

        type Order = { oid: number; coin: string; side: string; sz: string; limitPx: string };

        const ordersToCancel: Order[] = [...(mainOrders as Order[]), ...(xyzOrders as Order[])];

        if (ordersToCancel.length === 0) {
          if (outputOpts.json) {
            output({ orders: [], message: 'No open orders to cancel' }, outputOpts);
          } else {
            outputSuccess('No open orders to cancel');
          }
          return;
        }

        if (!options.yes && !outputOpts.yes) {
          const msg = `Cancel all ${ordersToCancel.length} open orders?`;
          if (!process.stdin.isTTY) {
            outputError(`${msg} Use -y to confirm.`, outputOpts, 'CONFIRMATION_REQUIRED');
            process.exit(1);
          }
          const { confirm } = await import('../../lib/prompts.js');
          const confirmed = await confirm(msg, false);
          if (!confirmed) {
            if (outputOpts.json) {
              output({ cancelled: true, message: 'User cancelled' }, outputOpts);
            } else {
              outputSuccess('Cancelled');
            }
            return;
          }
        }

        // Single API call to resolve all asset indices
        const allAssets = await getAllAssetInfo(publicClient);
        const coinToAssetIndex = new Map(allAssets.map((a) => [a.coin, a.assetIndex]));

        const cancels = ordersToCancel.map((o) => {
          const assetIndex = coinToAssetIndex.get(o.coin);
          if (assetIndex === undefined) {
            throw new Error(`Unknown coin in open orders: ${o.coin}`);
          }
          return { a: assetIndex, o: o.oid };
        });

        const result = await client.cancel({ cancels });

        if (outputOpts.json) {
          output(result, outputOpts);
        } else {
          outputSuccess(`Cancelled ${ordersToCancel.length} orders`);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'CANCEL_ERROR');
        process.exit(1);
      }
    });
}
