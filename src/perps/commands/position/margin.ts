import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { validatePositiveNumber } from '../../lib/validation.js';
import { getAssetInfo, dexNameToOpt, resolveSplitCoinArg } from '../order/shared.js';

type MarginAction = 'add' | 'remove';

function validateMarginAction(value: string): MarginAction {
  const lower = value.toLowerCase();
  if (lower === 'add') return 'add';
  if (lower === 'remove') return 'remove';
  throw new Error('Action must be "add" or "remove"');
}

export function registerMarginCommand(position: Command): void {
  position
    .command('margin')
    .description('Add or remove margin for an isolated position')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .argument('<action>', 'Action: add or remove')
    .argument('<amount>', 'Amount in USDC')
    .allowExcessArguments()
    .action(async function (
      this: Command,
      coin: string,
      actionArg: string,
      amountArg: string,
      _options: Record<string, unknown>,
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        const extraArgs = this.args.slice(3);
        let resolvedCoin: string;
        let resolvedActionArg: string;
        let resolvedAmountArg: string;

        if (extraArgs.length >= 1) {
          const split = resolveSplitCoinArg(coin, actionArg, [amountArg, ...extraArgs]);
          resolvedCoin = split.coin;
          resolvedActionArg = split.nextArg;
          resolvedAmountArg = extraArgs[0];
        } else {
          resolvedCoin = coin;
          resolvedActionArg = actionArg;
          resolvedAmountArg = amountArg;
        }

        const action = validateMarginAction(resolvedActionArg);
        const amount = validatePositiveNumber(resolvedAmountArg, 'amount');
        const amountDec = new Decimal(amount);

        const assetInfo = await getAssetInfo(publicClient, resolvedCoin);

        const activeData = await publicClient.activeAssetData({ user: address, coin: assetInfo.coin });

        if (activeData.leverage.type !== 'isolated') {
          throw new Error(
            `Margin adjustment is only available for isolated positions. ${assetInfo.coin} is currently in cross margin mode. Switch to isolated mode first with: position margin-mode ${resolvedCoin} isolated`,
          );
        }

        const dexOpt = dexNameToOpt(assetInfo.dexName);
        const state = await publicClient.clearinghouseState({ user: address, ...dexOpt } as any);

        const posData = state.assetPositions.find(
          (ap: any) => ap.position.coin === assetInfo.coin,
        );

        if (!posData || new Decimal(posData.position.szi || '0').isZero()) {
          throw new Error(`No open position found for ${assetInfo.coin}`);
        }

        const pos = posData.position;
        const szi = new Decimal(pos.szi);
        const isBuy = szi.gt(0);
        const marginUsed = new Decimal(pos.marginUsed || '0');
        const positionValue = new Decimal(pos.positionValue || '0').abs();

        if (action === 'add') {
          // freeSpot = max(0, spotTotal - spotHold) — matches computeUserAccount
          const spotState = await publicClient.spotClearinghouseState({ user: address });
          const usdcBalance = spotState.balances.find((b: any) => b.coin === 'USDC');
          const spotTotal = new Decimal(usdcBalance?.total || '0');
          const spotHold = new Decimal(usdcBalance?.hold || '0');
          const freeSpot = Decimal.max(spotTotal.minus(spotHold), 0);

          // dexWithdrawable — per-DEX withdrawable, matches handleUserState
          const dexWithdrawable = Decimal.max(new Decimal(state.withdrawable || '0'), 0);

          // dexAvailableToTrade = freeSpot + dexWithdrawable — matches computeUserAccount
          const availableToAdd = freeSpot.plus(dexWithdrawable);

          if (amountDec.gt(availableToAdd)) {
            throw new Error(
              `Amount $${amountDec.toFixed(2)} exceeds available balance $${availableToAdd.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`,
            );
          }
        } else {
          const leverage = activeData.leverage.value;
          const initialMarginRequired = positionValue.div(leverage);
          const minPositionMargin = positionValue.mul(0.1);
          const transferMarginRequired = Decimal.max(initialMarginRequired, minPositionMargin);
          const maxRemovable = marginUsed.minus(transferMarginRequired);
          const maxRemovablePositive = maxRemovable.gt(0) ? maxRemovable : new Decimal(0);

          if (amountDec.gt(maxRemovablePositive)) {
            throw new Error(
              `Amount $${amountDec.toFixed(2)} exceeds max removable margin $${maxRemovablePositive.toDecimalPlaces(2, Decimal.ROUND_DOWN).toFixed(2)}`,
            );
          }
        }

        const signed = action === 'add' ? amountDec : amountDec.neg();
        const ntli = signed.mul(1_000_000).round().toNumber();

        const result = await client.updateIsolatedMargin({
          asset: assetInfo.assetIndex,
          isBuy,
          ntli,
        });

        if (outputOpts.json) {
          output({
            coin: assetInfo.coin,
            action,
            amount: amountDec.toFixed(2),
            marginBefore: marginUsed.toDecimalPlaces(2).toFixed(2),
            ...result,
          }, outputOpts);
        } else {
          const sign = action === 'add' ? '+' : '-';
          outputSuccess(
            `Margin ${action === 'add' ? 'added' : 'removed'}: ${sign}$${amountDec.toFixed(2)} for ${assetInfo.coin} (${isBuy ? 'Long' : 'Short'})`,
          );
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'MARGIN_ERROR');
        process.exit(1);
      }
    });
}
