import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validatePositiveNumber, validateTif } from '../../lib/validation.js';
import { validateSideWithAliases, getAssetInfo, resolveSplitCoinArg, formatPrice, formatSize, formatOrderStatus, buildTpSlOrders } from './shared.js';
import { HL_TPSL_SLIPPAGE_PCT } from '../../constants.js';

export function registerLimitCommand(order: Command): void {
  order
    .command('limit')
    .description('Place a limit order')
    .argument('<side>', 'Order side: buy, sell, long, or short')
    .argument('<size>', 'Order size')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .argument('<price>', 'Limit price')
    .allowExcessArguments()
    .option('--tif <tif>', 'Time-in-force: Gtc, Ioc, Alo', 'Gtc')
    .option('--reduce-only', 'Reduce-only order')
    .option('--tp <price>', 'Take profit price')
    .option('--sl <price>', 'Stop loss price')
    .action(async function (
      this: Command,
      sideArg: string,
      sizeArg: string,
      coin: string,
      priceArg: string,
      options: {
        tif?: string;
        reduceOnly?: boolean;
        tp?: string;
        sl?: string;
      },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();

        const side = validateSideWithAliases(sideArg);
        const size = validatePositiveNumber(sizeArg, 'size');
        const isBuy = side === 'buy';

        const { coin: resolvedCoin, nextArg: resolvedPriceArg } =
          resolveSplitCoinArg(coin, priceArg, this.args.slice(4));
   
        const limitPx = validatePositiveNumber(resolvedPriceArg, 'price');
        const tif = validateTif(options.tif || 'Gtc');

        const { assetIndex, szDecimals } = await getAssetInfo(publicClient, resolvedCoin);

        const orderObj = {
          a: assetIndex,
          b: isBuy,
          p: formatPrice(limitPx, szDecimals),
          s: formatSize(size, szDecimals),
          r: options.reduceOnly || false,
          t: { limit: { tif } },
        };

        const hasTpSl = options.tp || options.sl;
        const orders: any[] = [orderObj];

        if (hasTpSl) {
          orders.push(...buildTpSlOrders(options, assetIndex, isBuy, size, szDecimals, HL_TPSL_SLIPPAGE_PCT));
        }

        const result = await client.order({
          orders,
          grouping: hasTpSl ? 'normalTpsl' : 'na',
        } as any);

        if (outputOpts.json) {
          output(result, outputOpts);
        } else {
          const statuses = (result as any).response?.data?.statuses ?? [];
          for (const status of statuses) {
            outputSuccess(formatOrderStatus(status));
          }
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'ORDER_ERROR');
        process.exit(1);
      }
    });
}
