import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';
import { stateKeyToDexName } from '../order/shared.js';
import { fetchAccountState } from '../../lib/fetch-states.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

export function registerInfoCommand(account: Command): void {
  account
    .command('info')
    .description('Show perps account info')
    .action(async function (this: Command) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const address = ctx.getWalletAddress();
        const { clearinghouseStates, spotBalances } = await fetchAccountState(ctx, address);

        // --- Aggregate perp data from all DEXes (mirrors frontend computeUserAccount) ---
        const states = clearinghouseStates;
        const allPositions = states.flatMap(
          ([, state]: [string, ClearinghouseStateResponse]) =>
            state?.assetPositions ?? [],
        );

        let totalUnrealizedPnl = new Decimal(0);
        let totalPositionMarginUsed = new Decimal(0);
        let crossMaintenanceMarginUsed = new Decimal(0);
        let totalDexWithdrawable = new Decimal(0);
        const dexWithdrawable: Record<string, Decimal> = {};
        const dexMarginUsed: Record<string, Decimal> = {};

        for (const [dexName, state] of states) {
          const dexKey = stateKeyToDexName(dexName);

          const marginUsedVal = new Decimal(
            state?.marginSummary?.totalMarginUsed ?? '0',
          );
          totalPositionMarginUsed = totalPositionMarginUsed.plus(marginUsedVal);
          dexMarginUsed[dexKey] = marginUsedVal;

          crossMaintenanceMarginUsed = crossMaintenanceMarginUsed.plus(
            new Decimal(state?.crossMaintenanceMarginUsed ?? '0'),
          );

          const withdrawableVal = new Decimal(state?.withdrawable ?? '0');
          totalDexWithdrawable = totalDexWithdrawable.plus(withdrawableVal);
          dexWithdrawable[dexKey] = Decimal.max(0, withdrawableVal);
        }

        for (const ap of allPositions) {
          const pos = ap?.position;
          if (pos) {
            totalUnrealizedPnl = totalUnrealizedPnl.plus(
              new Decimal(pos.unrealizedPnl ?? '0'),
            );
          }
        }

        // --- Extract spot USDC balance ---
        const usdcBalance = spotBalances.find(
          (b: { coin: string; total: string; hold: string }) =>
            b.coin === 'USDC',
        );
        const spotTotal = new Decimal(usdcBalance?.total ?? '0');
        const spotHold = new Decimal(usdcBalance?.hold ?? '0');

        // --- Compute final values (mirrors frontend computeUserAccount) ---
        const freeSpot = Decimal.max(0, spotTotal.minus(spotHold));
        const accountValue = spotTotal.plus(totalUnrealizedPnl);
        const withdrawable = freeSpot;
        const availableMargin = freeSpot.plus(totalDexWithdrawable);

        // Per-DEX available to trade
        const allDexKeys = new Set([
          ...Object.keys(dexMarginUsed),
          ...Object.keys(dexWithdrawable),
        ]);
        const dexAvailableToTrade: Record<string, string> = {};
        for (const dexKey of allDexKeys) {
          dexAvailableToTrade[dexKey] = freeSpot
            .plus(dexWithdrawable[dexKey] ?? new Decimal(0))
            .toFixed(6);
        }

        const totalNtlPos = allPositions.reduce(
          (sum: Decimal, ap: { position: { positionValue: string } }) =>
            sum.plus(new Decimal(ap?.position?.positionValue ?? '0').abs()),
          new Decimal(0),
        );

        const balanceData = {
          address,
          spotTotal: spotTotal.toFixed(6),
          accountValue: accountValue.toFixed(6),
          totalMarginUsed: totalPositionMarginUsed.toFixed(6),
          maintenanceMarginUsed: crossMaintenanceMarginUsed.toFixed(6),
          totalNtlPos: totalNtlPos.toFixed(6),
          unrealizedPnl: totalUnrealizedPnl.toFixed(6),
          withdrawable: withdrawable.toFixed(6),
          availableMargin: availableMargin.toFixed(6),
          dexAvailableToTrade,
        };

        if (outputOpts.json) {
          output(balanceData, outputOpts);
        } else {
          console.log('\nPerps Account Balance\n');
          console.log(`  Address:              ${balanceData.address}`);
          console.log(`  Spot USDC:            $${balanceData.spotTotal}`);
          console.log(`  Account Value:        $${balanceData.accountValue}`);
          console.log(`  Margin Used:          $${balanceData.totalMarginUsed}`);
          console.log(`  Maintenance Margin:   $${balanceData.maintenanceMarginUsed}`);
          console.log(`  Position Value:       $${balanceData.totalNtlPos}`);
          console.log(`  Unrealized PnL:       $${balanceData.unrealizedPnl}`);
          console.log(`  Withdrawable:         $${balanceData.withdrawable}`);
          console.log(`  Available Margin:     $${balanceData.availableMargin}`);
          console.log('');
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'ACCOUNT_ERROR');
        process.exit(1);
      }
    });
}
