import Decimal from 'decimal.js';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { getAssetInfo, formatPrice, formatOrderStatus, isKnownDex, dexNameToStateKey, dexNameToOpt } from '../order/shared.js';
import { fetchAllDexsClearinghouseStates } from '../../lib/fetch-states.js';
import { HL_TPSL_SLIPPAGE_PCT } from '../../constants.js';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

interface TpSlOrder {
  oid: number;
  triggerPx: string;
  orderType: string;
  side: string;
  sz: string;
}

function findExistingTpSl(
  orders: any[],
  coin: string,
): { tp: TpSlOrder | null; sl: TpSlOrder | null } {
  let tp: TpSlOrder | null = null;
  let sl: TpSlOrder | null = null;

  for (const order of orders) {
    if (order.coin !== coin || !order.isPositionTpsl) continue;

    const orderType = String(order.orderType || '');
    const triggerPx = String(order.triggerPx || order.limitPx || '');

    if (orderType.includes('Take Profit') && !tp) {
      tp = { oid: order.oid, triggerPx, orderType, side: order.side, sz: order.sz };
    } else if (orderType.includes('Stop') && !sl) {
      sl = { oid: order.oid, triggerPx, orderType, side: order.side, sz: order.sz };
    }
  }

  return { tp, sl };
}

export function registerTpSlCommand(position: Command): void {
  position
    .command('tpsl')
    .description('Set or manage take-profit / stop-loss on an existing position')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .allowExcessArguments()
    .option('--tp <price>', 'Take profit trigger price')
    .option('--sl <price>', 'Stop loss trigger price')
    .option('--cancel-tp', 'Cancel existing take profit order')
    .option('--cancel-sl', 'Cancel existing stop loss order')
    .action(async function (
      this: Command,
      coin: string,
      options: {
        tp?: string;
        sl?: string;
        cancelTp?: boolean;
        cancelSl?: boolean;
      },
    ) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getWalletClient();
        const publicClient = ctx.getPublicClient();
        const address = ctx.getWalletAddress();

        // Resolve coin with DEX prefix support
        const excessArgs = this.args.slice(1);
        let resolvedCoin = coin;
        if (excessArgs.length > 0 && isKnownDex(coin)) {
          resolvedCoin = `${coin}:${excessArgs[0]}`;
        }

        const { assetIndex, szDecimals, coin: apiCoin, dexName } = await getAssetInfo(publicClient, resolvedCoin);

        // Verify position exists (filter by resolved DEX)
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

        // Fetch existing TP/SL orders from the resolved DEX only
        const dexOrders = await publicClient.frontendOpenOrders({ user: address, ...dexNameToOpt(dexName) });
        const existing = findExistingTpSl(dexOrders as any[], apiCoin);

        const wantCancel = options.cancelTp || options.cancelSl;
        const wantSet = options.tp || options.sl;

        // Cancel existing TP/SL orders
        if (wantCancel) {
          const cancels: { a: number; o: number }[] = [];

          if (options.cancelTp) {
            if (!existing.tp) {
              throw new Error(`No existing take profit order for ${apiCoin}`);
            }
            cancels.push({ a: assetIndex, o: existing.tp.oid });
          }
          if (options.cancelSl) {
            if (!existing.sl) {
              throw new Error(`No existing stop loss order for ${apiCoin}`);
            }
            cancels.push({ a: assetIndex, o: existing.sl.oid });
          }

          const result = await client.cancel({ cancels });

          if (outputOpts.json) {
            output(result, outputOpts);
          } else {
            for (const cancel of cancels) {
              const type = cancel.o === existing.tp?.oid ? 'Take Profit' : 'Stop Loss';
              outputSuccess(`${type} order cancelled (OID: ${cancel.o})`);
            }
          }
          return;
        }

        // Set new TP/SL orders
        if (wantSet) {
          // Fetch mid price from the resolved DEX for direction validation
          const mids = await publicClient.allMids(dexNameToOpt(dexName)) as Record<string, string>;
          const mid = new Decimal(mids[apiCoin] ?? '0');

          if (options.tp) {
            const tpPrice = new Decimal(options.tp);
            if (tpPrice.isNaN() || tpPrice.lte(0)) throw new Error('tp must be a positive number');
            if (mid.isFinite() && mid.gt(0)) {
              if (isLong && tpPrice.lte(mid)) {
                throw new Error(`TP price must be greater than current price (${mid.toFixed()}) for Long position`);
              }
              if (!isLong && tpPrice.gte(mid)) {
                throw new Error(`TP price must be less than current price (${mid.toFixed()}) for Short position`);
              }
            }
          }

          if (options.sl) {
            const slPrice = new Decimal(options.sl);
            if (slPrice.isNaN() || slPrice.lte(0)) throw new Error('sl must be a positive number');
            if (mid.isFinite() && mid.gt(0)) {
              if (isLong && slPrice.gte(mid)) {
                throw new Error(`SL price must be less than current price (${mid.toFixed()}) for Long position`);
              }
              if (!isLong && slPrice.lte(mid)) {
                throw new Error(`SL price must be greater than current price (${mid.toFixed()}) for Short position`);
              }
            }
          }

          // Check if there are existing orders that need to be cancelled first
          const preCancels: { a: number; o: number }[] = [];
          if (options.tp && existing.tp) {
            preCancels.push({ a: assetIndex, o: existing.tp.oid });
          }
          if (options.sl && existing.sl) {
            preCancels.push({ a: assetIndex, o: existing.sl.oid });
          }
          if (preCancels.length > 0) {
            await client.cancel({ cancels: preCancels });
          }

          // Build position TP/SL orders
          const slippage = new Decimal(HL_TPSL_SLIPPAGE_PCT).div(100);
          const tpslSide = !isLong; // opposite of position direction
          const slippageMul = tpslSide
            ? new Decimal(1).plus(slippage)
            : new Decimal(1).minus(slippage);

          const orders: any[] = [];

          if (options.tp) {
            const triggerPx = formatPrice(options.tp, szDecimals);
            orders.push({
              a: assetIndex,
              b: tpslSide,
              p: formatPrice(new Decimal(triggerPx).mul(slippageMul), szDecimals),
              s: '0', // close entire position
              r: true,
              t: {
                trigger: {
                  isMarket: true,
                  triggerPx,
                  tpsl: 'tp',
                },
              },
            });
          }

          if (options.sl) {
            const triggerPx = formatPrice(options.sl, szDecimals);
            orders.push({
              a: assetIndex,
              b: tpslSide,
              p: formatPrice(new Decimal(triggerPx).mul(slippageMul), szDecimals),
              s: '0', // close entire position
              r: true,
              t: {
                trigger: {
                  isMarket: true,
                  triggerPx,
                  tpsl: 'sl',
                },
              },
            });
          }

          const MAX_RETRIES = 2;
          let orderResult: any;
          let lastError: Error | null = null;

          for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
              orderResult = await client.order({
                orders,
                grouping: 'positionTpsl' as const,
              } as any);
              lastError = null;
              break;
            } catch (err) {
              lastError = err instanceof Error ? err : new Error(String(err));
            }
          }

          if (lastError) {
            if (preCancels.length > 0) {
              const restoreOrders: any[] = [];
              if (options.tp && existing.tp) {
                const triggerPx = formatPrice(existing.tp.triggerPx, szDecimals);
                restoreOrders.push({
                  a: assetIndex,
                  b: tpslSide,
                  p: formatPrice(new Decimal(triggerPx).mul(slippageMul), szDecimals),
                  s: '0',
                  r: true,
                  t: { trigger: { isMarket: true, triggerPx, tpsl: 'tp' } },
                });
              }
              if (options.sl && existing.sl) {
                const triggerPx = formatPrice(existing.sl.triggerPx, szDecimals);
                restoreOrders.push({
                  a: assetIndex,
                  b: tpslSide,
                  p: formatPrice(new Decimal(triggerPx).mul(slippageMul), szDecimals),
                  s: '0',
                  r: true,
                  t: { trigger: { isMarket: true, triggerPx, tpsl: 'sl' } },
                });
              }
              if (restoreOrders.length > 0) {
                try {
                  await client.order({ orders: restoreOrders, grouping: 'positionTpsl' as const } as any);
                } catch {
                  throw new Error(
                    `Failed to set new TP/SL and could not restore previous orders. Position may be unprotected. Original error: ${lastError.message}`,
                  );
                }
              }
            }
            throw lastError;
          }

          if (outputOpts.json) {
            output(orderResult, outputOpts);
          } else {
            const statuses = (orderResult as any).response?.data?.statuses ?? [];
            for (const status of statuses) {
              outputSuccess(formatOrderStatus(status));
            }
          }
          return;
        }

        // No flags: show current TP/SL status
        const displayData = {
          coin: apiCoin,
          side: isLong ? 'Long' : 'Short',
          size: currentSzi.abs().toString(),
          entryPx: pos.entryPx,
          tp: existing.tp
            ? `${existing.tp.triggerPx} (OID: ${existing.tp.oid})`
            : '-',
          sl: existing.sl
            ? `${existing.sl.triggerPx} (OID: ${existing.sl.oid})`
            : '-',
        };

        output(displayData, outputOpts);
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'TPSL_ERROR');
        process.exit(1);
      }
    });
}
