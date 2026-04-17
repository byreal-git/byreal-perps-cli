import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validatePositiveNumber, validateTif } from '../../lib/validation.js';
import { getAssetInfo, resolveSplitCoinArg, formatPrice, formatSize, formatOrderStatus, dexNameToStateKey, dexNameToOpt } from '../order/shared.js';
import { fetchAllDexsClearinghouseStates } from '../../lib/fetch-states.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

export function registerCloseLimitCommand(position: Command): void {
  position
    .command('close-limit')
    .description('Close a position with a limit order')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .argument('<price>', 'Limit price')
    .allowExcessArguments()
    .option('--size <n>', 'Partial close size (default: full close)')
    .option('--tif <tif>', 'Time-in-force: Gtc, Ioc, Alo', 'Gtc')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function (
      this: Command,
      coin: string,
      priceArg: string,
      options: {
        size?: string;
        tif?: string;
        yes?: boolean;
      },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        const { coin: resolvedCoin, nextArg: resolvedPriceArg } =
          resolveSplitCoinArg(coin, priceArg, this.args.slice(2));

        const limitPx = validatePositiveNumber(resolvedPriceArg, 'price');
        const tif = validateTif(options.tif || 'Ioc');

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

        const isBuy = !isLong;

        // Validate limit price against mark to catch typos
        const mids = await publicClient.allMids(dexNameToOpt(dexName)) as Record<string, string>;
        const midStr = mids[apiCoin];
        if (midStr) {
          const mid = new Decimal(midStr);
          if (mid.isFinite() && mid.gt(0)) {
            const limitDec = new Decimal(limitPx);
            const wouldFillImmediately = isBuy ? limitDec.gte(mid) : limitDec.lte(mid);
            const slippagePct = limitDec.minus(mid).abs().div(mid).mul(100);
            if (wouldFillImmediately && slippagePct.gt(5) && !options.yes && !outputOpts.yes) {
              const side = isBuy ? 'buy' : 'sell';
              const msg = `Limit ${side} at ${limitPx} is ${slippagePct.toFixed(1)}% away from mark ${mid}. This will fill immediately with significant slippage.`;
              if (!process.stdin.isTTY) {
                outputError(`${msg} Use -y to confirm.`);
                process.exit(1);
              }
              const { confirm } = await import('../../lib/prompts.js');
              const confirmed = await confirm(`${msg} Continue?`, false);
              if (!confirmed) {
                outputSuccess('Cancelled');
                return;
              }
            }
          }
        }

        const result = await client.order({
          orders: [
            {
              a: assetIndex,
              b: isBuy,
              p: formatPrice(limitPx, szDecimals),
              s: formatSize(closeSize, szDecimals),
              r: true,
              t: { limit: { tif } },
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
