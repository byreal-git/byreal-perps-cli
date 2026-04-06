import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validateLeverage } from '../../lib/validation.js';
import { getAssetInfo, resolveSplitCoinArg } from '../order/shared.js';

export function registerLeverageCommand(position: Command): void {
  position
    .command('leverage')
    .description('Set leverage for a coin')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .argument('<leverage>', 'Leverage value (1-50)')
    .allowExcessArguments()
    .option('--cross', 'Use cross margin (default)')
    .option('--isolated', 'Use isolated margin')
    .action(async function (
      this: Command,
      coin: string,
      leverageArg: string,
      options: { cross?: boolean; isolated?: boolean },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();

        const { coin: resolvedCoin, nextArg: resolvedLeverageArg } =
          resolveSplitCoinArg(coin, leverageArg, this.args.slice(2));

        const leverage = validateLeverage(resolvedLeverageArg);
        const { assetIndex } = await getAssetInfo(publicClient, resolvedCoin);

        const isCross = options.cross || !options.isolated;

        const result = await client.updateLeverage({
          asset: assetIndex,
          isCross,
          leverage,
        });

        if (outputOpts.json) {
          output(result, outputOpts);
        } else {
          outputSuccess(
            `Leverage set to ${leverage}x (${isCross ? 'cross' : 'isolated'}) for ${resolvedCoin}`,
          );
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'LEVERAGE_ERROR');
        process.exit(1);
      }
    });
}
