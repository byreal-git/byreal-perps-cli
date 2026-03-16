import type { PerpsContext } from '../cli/context.js';
import type { Address } from 'viem';
import type { ClearinghouseStateResponse } from '@nktkas/hyperliquid';

const WS_TIMEOUT = 10_000;

/**
 * Fetch clearinghouse states from all DEXes.
 * Tries WebSocket subscription first; falls back to HTTP API on failure/timeout.
 */
export async function fetchAllDexsClearinghouseStates(
  ctx: PerpsContext,
  address: Address,
): Promise<[string, ClearinghouseStateResponse][]> {
  try {
    const subClient = ctx.getSubscriptionClient();
    let resolve: () => void;
    const ready = new Promise<void>((r) => { resolve = r; });
    let states: [string, ClearinghouseStateResponse][] = [];

    const sub = await subClient.allDexsClearinghouseState(
      { user: address },
      (data) => {
        states = data.clearinghouseStates;
        resolve!();
      },
    );

    await Promise.race([
      ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WebSocket timeout')), WS_TIMEOUT),
      ),
    ]);

    await sub.unsubscribe();
    await ctx.closeWebSocket();
    return states;
  } catch {
    await ctx.closeWebSocket().catch(() => {});
    const client = ctx.getPublicClient();
    const [mainState, xyzState] = await Promise.all([
      client.clearinghouseState({ user: address }),
      client.clearinghouseState({ user: address, dex: 'xyz' }),
    ]);
    return [['', mainState], ['xyz', xyzState]];
  }
}

/**
 * Fetch both clearinghouse states and spot balances.
 * Tries WebSocket subscriptions first; falls back to HTTP API on failure/timeout.
 */
export async function fetchAccountState(
  ctx: PerpsContext,
  address: Address,
): Promise<{
  clearinghouseStates: [string, ClearinghouseStateResponse][];
  spotBalances: { coin: string; total: string; hold: string }[];
}> {
  try {
    const subClient = ctx.getSubscriptionClient();

    let perpData: any;
    let spotData: any;
    let perpResolve: () => void;
    let spotResolve: () => void;

    const perpReady = new Promise<void>((r) => { perpResolve = r; });
    const spotReady = new Promise<void>((r) => { spotResolve = r; });

    const [perpSub, spotSub] = await Promise.all([
      subClient.allDexsClearinghouseState({ user: address }, (data) => {
        perpData = data;
        perpResolve!();
      }),
      subClient.spotState({ user: address }, (data) => {
        spotData = data;
        spotResolve!();
      }),
    ]);

    await Promise.race([
      Promise.all([perpReady, spotReady]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WebSocket timeout')), WS_TIMEOUT),
      ),
    ]);

    await Promise.all([perpSub.unsubscribe(), spotSub.unsubscribe()]);
    await ctx.closeWebSocket();

    return {
      clearinghouseStates: perpData.clearinghouseStates,
      spotBalances: spotData.spotState.balances,
    };
  } catch {
    await ctx.closeWebSocket().catch(() => {});
    const client = ctx.getPublicClient();
    const [mainState, xyzState, spotState] = await Promise.all([
      client.clearinghouseState({ user: address }),
      client.clearinghouseState({ user: address, dex: 'xyz' }),
      client.spotClearinghouseState({ user: address }),
    ]);
    return {
      clearinghouseStates: [['', mainState], ['xyz', xyzState]],
      spotBalances: spotState.balances,
    };
  }
}
