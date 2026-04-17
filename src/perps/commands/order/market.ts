import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validatePositiveNumber } from '../../lib/validation.js';
import { getOrderConfig } from '../../lib/order-config.js';
import { validateSideWithAliases, getAssetInfo, isKnownDex, getMidPrice, formatPrice, formatSize, formatOrderStatus, buildTpSlOrders } from './shared.js';
import { HL_TPSL_SLIPPAGE_PCT } from '../../constants.js';

export function registerMarketCommand(order: Command): void {
  order
    .command('market')
    .description('Place a market order')
    .argument('<side>', 'Order side: buy, sell, long, or short')
    .argument('<size>', 'Order size')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .allowExcessArguments()
    .option('--slippage <pct>', 'Slippage percentage (overrides config)')
    .option('--reduce-only', 'Reduce-only order')
    .option('--tp <price>', 'Take profit price')
    .option('--sl <price>', 'Stop loss price')
    .action(async function (
      this: Command,
      sideArg: string,
      sizeArg: string,
      coin: string,
      options: {
        slippage?: string;
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

        const excessArgs = this.args.slice(3);
        let resolvedCoin = coin;
        if (excessArgs.length > 0) {
          if (!isKnownDex(coin)) {
            throw new Error(`Unknown coin: ${coin}:${excessArgs[0]}`);
          }
          resolvedCoin = `${coin}:${excessArgs[0]}`;
        }
        const asset = await getAssetInfo(publicClient, resolvedCoin);
        const { assetIndex, szDecimals, coin: apiCoin } = asset;

        const config = getOrderConfig();
        const slippagePct = new Decimal(
          options.slippage ?? config.slippage,
        ).div(100);

        const midPrice = await getMidPrice(publicClient, apiCoin, asset.dexName);

        const limitPx = isBuy
          ? midPrice.mul(new Decimal(1).plus(slippagePct))
          : midPrice.mul(new Decimal(1).minus(slippagePct));

        const orderObj = {
          a: assetIndex,
          b: isBuy,
          p: formatPrice(limitPx, szDecimals),
          s: formatSize(size, szDecimals),
          r: options.reduceOnly || false,
          t: { limit: { tif: 'Ioc' as const } },
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
