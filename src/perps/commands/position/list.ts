import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';
import { stateKeyToDexName } from '../order/shared.js';
import { fetchAllDexsClearinghouseStates } from '../../lib/fetch-states.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

function mapPositions(
  assetPositions: ClearinghouseStateResponse['assetPositions'],
  dex: string,
) {
  return assetPositions
    .filter((ap) => !new Decimal(ap.position.szi || '0').isZero())
    .map((ap) => {
      const pos = ap.position;
      const szi = new Decimal(pos.szi);
      const absSize = szi.abs();
      return {
        coin: pos.coin,
        dex,
        side: szi.gt(0) ? 'Long' : 'Short',
        size: absSize.toString(),
        entryPx: pos.entryPx,
        markPx: pos.positionValue
          ? new Decimal(pos.positionValue).abs().div(absSize).toFixed(2)
          : '-',
        leverage: pos.leverage?.value ?? '-',
        marginType: pos.leverage?.type ?? 'cross',
        liquidationPx: pos.liquidationPx ?? '-',
        unrealizedPnl: pos.unrealizedPnl ?? '-',
        returnOnEquity: pos.returnOnEquity ?? '-',
        marginUsed: pos.marginUsed ?? '-',
      };
    });
}

export function registerPositionListCommand(position: Command): void {
  position
    .command('list')
    .alias('ls')
    .description('List open positions')
    .option('--coin <symbol>', 'Filter by coin symbol (e.g., BTC, ETH)')
    .action(async function (this: Command, opts: { coin?: string }) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const address = ctx.getWalletAddress();
        const clearinghouseStates = await fetchAllDexsClearinghouseStates(ctx, address);

        // Aggregate positions from all DEXes
        let positions = clearinghouseStates.flatMap(
          ([dexName, state]: [string, ClearinghouseStateResponse]) => {
            const dexKey = stateKeyToDexName(dexName);
            return mapPositions(state?.assetPositions ?? [], dexKey);
          },
        );

        // Filter by coin if specified
        if (opts.coin) {
          const coinUpper = opts.coin.toUpperCase();
          positions = positions.filter((p) => p.coin === coinUpper);
        }

        if (positions.length === 0) {
          if (outputOpts.json) {
            output([], outputOpts);
          } else {
            console.log(opts.coin
              ? `No open positions for ${opts.coin.toUpperCase()}`
              : 'No open positions');
          }
          return;
        }

        output(positions, outputOpts);
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'POSITION_ERROR');
        process.exit(1);
      }
    });
}
