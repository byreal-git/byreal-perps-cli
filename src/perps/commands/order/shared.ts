import Decimal from 'decimal.js';
import type { InfoClient } from '@nktkas/hyperliquid';

export { validateSideWithAliases } from '../../lib/validation.js';
export type { OrderSide as Side } from '../../types.js';

export interface AssetInfo {
  assetIndex: number;
  szDecimals: number;
  /** Resolved coin name as it appears in the API (e.g., "GOLD", not "xyz:gold") */
  coin: string;
  /** DEX index in allPerpMetas array (0 = main, 1+ = HIP-3) */
  dexIndex: number;
  /** DEX name from registry (e.g., "main", "xyz") */
  dexName: string;
  /** Whether the asset only supports isolated margin (deprecated, use marginMode) */
  onlyIsolated: boolean;
  /** Margin mode restriction: 'strictIsolated' | 'noCross' | undefined (allows cross) */
  marginMode?: string;
  /** Maximum leverage allowed for this asset */
  maxLeverage: number;
}

// DEX name registry: array index → name prefix
const DEX_NAME_REGISTRY: Record<number, string> = {
  0: 'main',
  1: 'xyz',
};

// Reverse lookup: name prefix → array index
const DEX_NAME_TO_INDEX: Record<string, number> = Object.fromEntries(
  Object.entries(DEX_NAME_REGISTRY).map(([k, v]) => [v, Number(k)]),
);

export function dexNameToStateKey(name: string): string {
  return name === 'main' ? '' : name;
}

export function stateKeyToDexName(key: string): string {
  return key === '' ? 'main' : key;
}

export function dexNameToOpt(name: string): { dex: string } | Record<string, never> {
  return name === 'main' ? {} : { dex: name };
}

/**
 * Parse coin input that may include a DEX prefix.
 * Supported formats:
 *   "BTC"       → { dex: undefined, name: "BTC" }
 *   "xyz:GOLD"  → { dex: "xyz",     name: "GOLD" }
 *   "xyz GOLD"  → { dex: "xyz",     name: "GOLD" }
 */
function parseCoinInput(coin: string): { dex?: string; name: string } {
  const colonIdx = coin.indexOf(':');
  if (colonIdx !== -1) {
    return {
      dex: coin.slice(0, colonIdx).toLowerCase(),
      name: coin.slice(colonIdx + 1).toUpperCase(),
    };
  }
  const spaceIdx = coin.indexOf(' ');
  if (spaceIdx !== -1) {
    return {
      dex: coin.slice(0, spaceIdx).toLowerCase(),
      name: coin.slice(spaceIdx + 1).trim().toUpperCase(),
    };
  }
  return { name: coin.toUpperCase() };
}

/**
 * Check if a string matches a known DEX name prefix.
 * Used by commands to detect split "xyz gold" input across positional args.
 */
export function isKnownDex(name: string): boolean {
  return DEX_NAME_TO_INDEX[name.toLowerCase()] !== undefined;
}

/**
 * Resolve a coin argument that may be split across two positional args.
 * When Commander receives `xyz gold 100`, it assigns coin="xyz", nextArg="gold".
 * This detects the split and recombines: coin → "xyz:gold", nextArg → extraArgs[0].
 */
export function resolveSplitCoinArg(
  coin: string,
  nextArg: string,
  extraArgs: string[],
): { coin: string; nextArg: string } {

  if (extraArgs.length > 0) {
    if (!isKnownDex(coin)) {
      throw new Error(`Unknown coin: ${coin}:${nextArg}`);
    }
    return { coin: `${coin}:${nextArg}`, nextArg: extraArgs[0] };
  }
  return { coin, nextArg };
}

function buildAssetIndex(dexIndex: number, marketIndex: number): number {
  return dexIndex === 0 ? marketIndex : 100000 + dexIndex * 10000 + marketIndex;
}

/**
 * Strip DEX prefix from coin name (e.g., "xyz:GOLD" → "GOLD").
 */
function stripDexPrefix(name: string): string {
  const colonIdx = name.indexOf(':');
  return colonIdx !== -1 ? name.slice(colonIdx + 1) : name;
}

function collectAssetsFromDex(
  dex: any,
  dexIndex: number,
  dexName: string,
): AssetInfo[] {
  if (!dex?.universe) return [];
  return dex.universe.map((asset: { name: string; szDecimals: number; onlyIsolated?: boolean; marginMode?: string; maxLeverage: number }, marketIndex: number) => ({
    assetIndex: buildAssetIndex(dexIndex, marketIndex),
    szDecimals: asset.szDecimals,
    coin: asset.name,
    dexIndex,
    dexName,
    onlyIsolated: asset.onlyIsolated ?? false,
    marginMode: asset.marginMode,
    maxLeverage: asset.maxLeverage,
  }));
}

/**
 * Fetch all asset info across all registered DEXes in a single API call.
 */
export async function getAllAssetInfo(
  publicClient: InfoClient,
): Promise<AssetInfo[]> {
  const allPerpMetas = await (publicClient as any).allPerpMetas();
  const results: AssetInfo[] = [];

  for (const [idxStr, dexName] of Object.entries(DEX_NAME_REGISTRY)) {
    const dexIndex = Number(idxStr);
    const dex = allPerpMetas[dexIndex];
    if (!dex) continue;
    results.push(...collectAssetsFromDex(dex, dexIndex, dexName));
  }

  return results;
}

/**
 * Resolve a single coin to its AssetInfo.
 * Accepts optional formats: "BTC" or "xyz:GOLD".
 */
export async function getAssetInfo(
  publicClient: InfoClient,
  coin: string,
): Promise<AssetInfo> {
  const parsed = parseCoinInput(coin);
  const allAssets = await getAllAssetInfo(publicClient);

  if (parsed.dex !== undefined) {
    const dexIndex = DEX_NAME_TO_INDEX[parsed.dex];
    if (dexIndex === undefined) {
      throw new Error(`Unknown DEX: ${parsed.dex}. Available: ${Object.values(DEX_NAME_REGISTRY).join(', ')}`);
    }
    const found = allAssets.find(
      (a) => a.dexIndex === dexIndex && stripDexPrefix(a.coin).toUpperCase() === parsed.name,
    );
    if (!found) {
      throw new Error(`Unknown coin: ${parsed.name} on ${parsed.dex}. Use the exact symbol (e.g., GOLD).`);
    }
    return found;
  }

  const found = allAssets.find(
    (a) => stripDexPrefix(a.coin).toUpperCase() === parsed.name,
  );
  if (!found) {
    throw new Error(`Unknown coin: ${parsed.name}. Use the exact symbol (e.g., BTC, ETH) or prefix with DEX (e.g., xyz:GOLD).`);
  }
  return found;
}

/**
 * Format price following Hyperliquid rules:
 * 1. Round to 5 significant figures
 * 2. Round to (maxDecimals - szDecimals) decimal places
 */
export function formatPrice(
  price: string | number | Decimal,
  szDecimals: number = 0,
  maxDecimals: number = 6,
): string {
  const d = new Decimal(price.toString());
  if (!d.isFinite() || d.isZero()) return '0';

  // Integer prices are always valid
  if (d.isInteger()) return d.toFixed(0);

  // 5 significant figures first
  const sigFigs = d.toSignificantDigits(5);

  // Then round to decimal limit
  const decimalLimit = Math.max(maxDecimals - szDecimals, 0);
  const result = sigFigs.toDecimalPlaces(decimalLimit, Decimal.ROUND_HALF_UP);

  return result.isZero() ? '0' : result.toFixed();
}

/**
 * Format size by truncating to szDecimals decimal places (no rounding).
 */
export function formatSize(size: string | number | Decimal, szDecimals: number): string {
  const d = new Decimal(size.toString());
  if (!d.isFinite() || d.isZero()) return '0';

  if (szDecimals <= 0) return d.truncated().toFixed(0);

  const truncated = d.toDecimalPlaces(szDecimals, Decimal.ROUND_DOWN);

  return truncated.isZero() ? '0' : truncated.toFixed();
}

export function formatOrderStatus(status: unknown): string {
  if (typeof status === 'string') {
    return status;
  }
  if (typeof status === 'object' && status !== null) {
    if ('filled' in status) {
      const filled = (status as { filled: { totalSz: string; avgPx: string; oid: number } }).filled;
      return `Filled: ${filled.totalSz} @ ${filled.avgPx} (OID: ${filled.oid})`;
    }
    if ('resting' in status) {
      const resting = (status as { resting: { oid: number } }).resting;
      return `Resting (OID: ${resting.oid})`;
    }
  }
  return String(status);
}

export async function getMidPrice(
  publicClient: InfoClient,
  coin: string,
  dexName?: string,
): Promise<Decimal> {
  const opt = dexName ? dexNameToOpt(dexName) : {};
  const mids = await publicClient.allMids(opt);
  const midStr = (mids as Record<string, string>)[coin];

  if (midStr) {
    const mid = new Decimal(midStr);
    if (mid.isFinite() && mid.gt(0)) return mid;
  }

  const book = await publicClient.l2Book({ coin, ...opt } as any);
  const levels = (book as any).levels as { px: string }[][];
  const bestBid = levels?.[0]?.[0]?.px;
  const bestAsk = levels?.[1]?.[0]?.px;
  if (bestBid && bestAsk) {
    const midPrice = new Decimal(bestBid).plus(bestAsk).div(2);
    if (midPrice.isFinite() && midPrice.gt(0)) return midPrice;
  }

  throw new Error(`Cannot get mid price for ${coin}`);
}

export interface TpSlOptions {
  tp?: string;
  sl?: string;
}

export function buildTpSlOrders(
  opts: TpSlOptions,
  assetIndex: number,
  isBuy: boolean,
  size: number | Decimal,
  szDecimals: number,
  tpslSlippagePct: number,
): any[] {
  const orders: any[] = [];
  const slippage = new Decimal(tpslSlippagePct).div(100);

  if (opts.tp) {
    const tpPrice = new Decimal(opts.tp);
    if (tpPrice.isNaN() || tpPrice.lte(0)) throw new Error('tp must be a positive number');
    const tpLimitPx = isBuy
      ? tpPrice.mul(new Decimal(1).minus(slippage))
      : tpPrice.mul(new Decimal(1).plus(slippage));

    orders.push({
      a: assetIndex,
      b: !isBuy,
      p: formatPrice(tpLimitPx, szDecimals),
      s: formatSize(size, szDecimals),
      r: true,
      t: {
        trigger: {
          isMarket: true,
          triggerPx: formatPrice(tpPrice, szDecimals),
          tpsl: 'tp',
        },
      },
    });
  }

  if (opts.sl) {
    const slPrice = new Decimal(opts.sl);
    if (slPrice.isNaN() || slPrice.lte(0)) throw new Error('sl must be a positive number');
    const slLimitPx = isBuy
      ? slPrice.mul(new Decimal(1).minus(slippage))
      : slPrice.mul(new Decimal(1).plus(slippage));

    orders.push({
      a: assetIndex,
      b: !isBuy,
      p: formatPrice(slLimitPx, szDecimals),
      s: formatSize(size, szDecimals),
      r: true,
      t: {
        trigger: {
          isMarket: true,
          triggerPx: formatPrice(slPrice, szDecimals),
          tpsl: 'sl',
        },
      },
    });
  }

  return orders;
}
