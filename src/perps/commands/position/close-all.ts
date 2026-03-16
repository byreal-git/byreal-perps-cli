import { Command } from 'commander';
import Decimal from 'decimal.js';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { getAllAssetInfo, formatPrice, formatSize, formatOrderStatus } from '../order/shared.js';
import { getOrderConfig } from '../../lib/order-config.js';
import { fetchAllDexsClearinghouseStates } from '../../lib/fetch-states.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

export function registerCloseAllCommand(position: Command): void {
  position
    .command('close-all')
    .description('Close all open positions at market price')
    .option('--slippage <pct>', 'Slippage percentage (overrides config)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async function (
      this: Command,
      options: {
        slippage?: string;
        yes?: boolean;
      },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        // Build asset meta map: coin → { assetIndex, szDecimals }
        const allAssets = await getAllAssetInfo(publicClient);
        const assetMetaMap = new Map(
          allAssets.map((a) => [a.coin.toUpperCase(), { assetIndex: a.assetIndex, szDecimals: a.szDecimals }]),
        );

        const clearinghouseStates = await fetchAllDexsClearinghouseStates(ctx, address);

        // Collect open positions with meta
        type PositionEntry = {
          coin: string;
          szi: Decimal;
          isLong: boolean;
          absSize: Decimal;
          assetIndex: number;
          szDecimals: number;
        };

        const positions: PositionEntry[] = clearinghouseStates.flatMap(
          ([, state]: [string, ClearinghouseStateResponse]) =>
            (state?.assetPositions ?? [])
              .filter((ap: any) => {
                const szi = new Decimal(ap.position.szi || '0');
                return !szi.isNaN() && !szi.isZero();
              })
              .map((ap: any) => {
                const meta = assetMetaMap.get(ap.position.coin.toUpperCase());
                const szi = new Decimal(ap.position.szi);
                return {
                  coin: ap.position.coin,
                  szi,
                  isLong: szi.gt(0),
                  absSize: szi.abs(),
                  assetIndex: meta?.assetIndex ?? -1,
                  szDecimals: meta?.szDecimals ?? 0,
                };
              })
              .filter((p) => p.assetIndex >= 0),
        );

        if (positions.length === 0) {
          outputSuccess('No open positions to close');
          return;
        }

        // Fetch mid prices from all DEXes
        const [mainMids, xyzMids] = await Promise.all([
          publicClient.allMids() as Promise<Record<string, string>>,
          publicClient.allMids({ dex: 'xyz' }) as Promise<Record<string, string>>,
        ]);
        const mids: Record<string, string> = { ...mainMids, ...xyzMids };

        const config = getOrderConfig();
        const slippagePct = new Decimal(
          options.slippage ?? config.slippage,
        ).div(100);

        // Build all close orders for a single batch API call
        const orders: any[] = [];
        const orderCoins: string[] = [];

        for (const pos of positions) {
          const midStr = mids[pos.coin];
          if (!midStr) {
            outputError(`Cannot get mid price for ${pos.coin}`);
            continue;
          }
          const mid = new Decimal(midStr);
          if (!mid.isFinite() || mid.lte(0)) {
            outputError(`Cannot get mid price for ${pos.coin}`);
            continue;
          }

          const isBuy = !pos.isLong;
          const limitPx = isBuy
            ? mid.mul(new Decimal(1).plus(slippagePct))
            : mid.mul(new Decimal(1).minus(slippagePct));

          orders.push({
            a: pos.assetIndex,
            b: isBuy,
            p: formatPrice(limitPx, pos.szDecimals),
            s: formatSize(pos.absSize, pos.szDecimals),
            r: true,
            t: { limit: { tif: 'Ioc' as const } },
          });
          orderCoins.push(pos.coin);
        }

        if (orders.length === 0) {
          outputError('No valid orders to submit');
          process.exit(1);
        }


        if (!options.yes) {
          const { confirm } = await import('../../lib/prompts.js');
          const coins = positions.map((p) => p.coin).join(', ');
          const msg = `Close ${positions.length} position(s): ${coins}?`;
          const confirmed = await confirm(msg, false);
          if (!confirmed) {
            outputSuccess('Cancelled');
            return;
          }
        }

        // Single batch API call
        const result = await client.order({
          orders,
          grouping: 'na' as const,
        } as any);

        if (outputOpts.json) {
          output(result, outputOpts);
        } else {
          const statuses = (result as any).response?.data?.statuses ?? [];
          for (let i = 0; i < statuses.length; i++) {
            const coin = orderCoins[i] ?? '';
            outputSuccess(`${coin}: ${formatOrderStatus(statuses[i])}`);
          }
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts);
        process.exit(1);
      }
    });
}
