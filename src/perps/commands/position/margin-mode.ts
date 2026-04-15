import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { getAssetInfo, resolveSplitCoinArg } from '../order/shared.js';
import { HL_DEFAULT_LEVERAGE } from '../../constants.js';

type MarginMode = 'cross' | 'isolated';

function validateMarginMode(value: string): MarginMode {
  const lower = value.toLowerCase();
  if (lower === 'cross') return 'cross';
  if (lower === 'isolated') return 'isolated';
  throw new Error('Margin mode must be "cross" or "isolated"');
}

function isCrossDisabled(asset: { onlyIsolated: boolean; marginMode?: string }): boolean {
  return (
    asset.marginMode === 'strictIsolated' ||
    asset.marginMode === 'noCross' ||
    asset.onlyIsolated
  );
}

export function registerMarginModeCommand(position: Command): void {
  position
    .command('margin-mode')
    .description('Switch margin mode between cross and isolated for a coin')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .argument('<mode>', 'Margin mode: cross or isolated')
    .allowExcessArguments()
    .action(async function (
      this: Command,
      coin: string,
      modeArg: string,
      _options: Record<string, unknown>,
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();

        const { coin: resolvedCoin, nextArg: resolvedModeArg } =
          resolveSplitCoinArg(coin, modeArg, this.args.slice(2));

        const targetMode = validateMarginMode(resolvedModeArg);
        const assetInfo = await getAssetInfo(publicClient, resolvedCoin);

        // Check if switching to cross is allowed
        if (targetMode === 'cross' && isCrossDisabled(assetInfo)) {
          throw new Error(
            `${assetInfo.coin} only supports isolated margin mode. Cross margin is not available for this asset.`,
          );
        }

        // Fetch current leverage via activeAssetData so we only change mode, not leverage value
        const address = ctx.getWalletAddress();
        const activeData = await publicClient.activeAssetData({ user: address, coin: assetInfo.coin });
        const leverage = activeData?.leverage?.value ?? HL_DEFAULT_LEVERAGE;

        const result = await client.updateLeverage({
          asset: assetInfo.assetIndex,
          isCross: targetMode === 'cross',
          leverage,
        });
        if (outputOpts.json) {
          output({ coin: assetInfo.coin, marginMode: targetMode, leverage, ...result }, outputOpts);
        } else {
          outputSuccess(`Margin mode switched to ${targetMode} for ${assetInfo.coin}`);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'MARGIN_MODE_ERROR');
        process.exit(1);
      }
    });
}
