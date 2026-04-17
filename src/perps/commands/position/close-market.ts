import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { getAssetInfo, formatPrice, formatSize, formatOrderStatus, isKnownDex, dexNameToStateKey, dexNameToOpt } from '../order/shared.js';
import { getOrderConfig } from '../../lib/order-config.js';
import { fetchAllDexsClearinghouseStates } from '../../lib/fetch-states.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

export function registerCloseMarketCommand(position: Command): void {
  position
    .command('close-market')
    .description('Close a position at market price')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .allowExcessArguments()
    .option('--size <n>', 'Partial close size (default: full close)')
    .option('--slippage <pct>', 'Slippage percentage (overrides config)')
    .action(async function (
      this: Command,
      coin: string,
      options: {
        size?: string;
        slippage?: string;
      },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        const excessArgs = this.args.slice(1);
        let resolvedCoin = coin;
        if (excessArgs.length > 0 && isKnownDex(coin)) {
          resolvedCoin = `${coin}:${excessArgs[0]}`;
        }

        const { assetIndex, szDecimals, coin: apiCoin, dexName } = await getAssetInfo(publicClient, resolvedCoin);

        const clearinghouseStates = await fetchAllDexsClearinghouseStates(ctx, address);

        const assetPosition = clearinghouseStates
          .filter(([name]: [string, ClearinghouseStateResponse]) => name === dexNameToStateKey(dexName))
          .flatMap(
            ([, state]: [string, ClearinghouseStateResponse]) =>
              (state?.assetPositions ?? []),
          ).find(
            (ap: any) => ap.position.coin.toUpperCase() === apiCoin.toUpperCase() && !new Decimal(ap.position.szi || '0').isZero(),
          );

        if (!assetPosition) {
          throw new Error(`No open position for ${apiCoin}`);
        }

        const pos = (assetPosition as any).position;
        const currentSzi = new Decimal(pos.szi);
        const isLong = currentSzi.gt(0);
        const absSize = currentSzi.abs();

        const closeSize = options.size ? new Decimal(options.size) : absSize;
        if (closeSize.lte(0) || closeSize.gt(absSize)) {
          throw new Error(`Invalid close size. Current position size: ${absSize.toString()}`);
        }

        const config = getOrderConfig();
        const slippagePct = new Decimal(
          options.slippage ?? config.slippage,
        ).div(100);

        const mids = await publicClient.allMids(dexNameToOpt(dexName)) as Record<string, string>;
        const mid = new Decimal(mids[apiCoin] ?? '0');
        if (!mid.isFinite() || mid.lte(0)) {
          throw new Error(`Cannot get mid price for ${apiCoin}`);
        }

        const isBuy = !isLong;
        const limitPx = isBuy
          ? mid.mul(new Decimal(1).plus(slippagePct))
          : mid.mul(new Decimal(1).minus(slippagePct));

        const result = await client.order({
          orders: [
            {
              a: assetIndex,
              b: isBuy,
              p: formatPrice(limitPx, szDecimals),
              s: formatSize(closeSize, szDecimals),
              r: true,
              t: { limit: { tif: 'FrontendMarket' as const } },
            },
          ],
          grouping: 'na' as const,
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
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'CLOSE_ERROR');
        process.exit(1);
      }
    });
}
