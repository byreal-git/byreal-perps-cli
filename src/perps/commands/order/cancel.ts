import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validatePositiveInteger } from '../../lib/validation.js';
import { getAssetInfo } from './shared.js';

export function registerCancelCommand(order: Command): void {
  order
    .command('cancel')
    .description('Cancel an order by OID')
    .argument('<oid>', 'Order ID to cancel')
    .action(async function (this: Command, oidArg: string) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const user = ctx.getWalletAddress();

        const orderId = validatePositiveInteger(oidArg, 'oid');

        // Fetch open orders from both DEXes to find asset index
        const [mainOrders, xyzOrders] = await Promise.all([
          publicClient.openOrders({ user }),
          publicClient.openOrders({ user, dex: 'xyz' }),
        ]);
        const allOrders = [...(mainOrders as any[]), ...(xyzOrders as any[])];
        const orderToCancel = allOrders.find((o: any) => o.oid === orderId);

        if (!orderToCancel) {
          throw new Error(`Order ${orderId} not found in open orders`);
        }

        const { assetIndex } = await getAssetInfo(publicClient, (orderToCancel as any).coin);

        const result = await client.cancel({
          cancels: [{ a: assetIndex, o: orderId }],
        });

        if (outputOpts.json) {
          output(result, outputOpts);
        } else {
          outputSuccess(`Order ${orderId} cancelled`);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'CANCEL_ERROR');
        process.exit(1);
      }
    });
}
