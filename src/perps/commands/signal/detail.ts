import Decimal from 'decimal.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';
import { getAssetInfo, isKnownDex, dexNameToOpt } from '../order/shared.js';
import type { InfoClient, CandleSnapshotResponse } from '@nktkas/hyperliquid';

// ============================================
// Technical Indicators
// ============================================

function computeRSI(closes: Decimal[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = new Decimal(0);
  let avgLoss = new Decimal(0);

  for (let i = 1; i <= period; i++) {
    const diff = closes[i].minus(closes[i - 1]);
    if (diff.gt(0)) avgGain = avgGain.plus(diff);
    else avgLoss = avgLoss.plus(diff.abs());
  }

  avgGain = avgGain.div(period);
  avgLoss = avgLoss.div(period);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i].minus(closes[i - 1]);
    if (diff.gt(0)) {
      avgGain = avgGain.mul(period - 1).plus(diff).div(period);
      avgLoss = avgLoss.mul(period - 1).div(period);
    } else {
      avgGain = avgGain.mul(period - 1).div(period);
      avgLoss = avgLoss.mul(period - 1).plus(diff.abs()).div(period);
    }
  }

  if (avgLoss.isZero()) return 100;
  const rs = avgGain.div(avgLoss);
  return new Decimal(100).minus(new Decimal(100).div(rs.plus(1))).toNumber();
}

function computeEMA(values: Decimal[], period: number): Decimal[] {
  if (values.length < period) return [];
  const k = new Decimal(2).div(period + 1);
  const ema: Decimal[] = [];

  // SMA for first value
  let sum = new Decimal(0);
  for (let i = 0; i < period; i++) sum = sum.plus(values[i]);
  ema.push(sum.div(period));

  for (let i = period; i < values.length; i++) {
    const prev = ema[ema.length - 1];
    ema.push(values[i].mul(k).plus(prev.mul(new Decimal(1).minus(k))));
  }
  return ema;
}

function computeMACD(closes: Decimal[]): {
  macd: Decimal[];
  signal: Decimal[];
  histogram: Decimal[];
} | null {
  if (closes.length < 26) return null;

  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);

  // Align arrays: ema12 starts at index 12, ema26 starts at index 26
  // So MACD line starts when both are available
  const offset = 26 - 12; // 14
  const macdLine: Decimal[] = [];
  for (let i = offset; i < ema12.length && i - offset < ema26.length; i++) {
    macdLine.push(ema12[i].minus(ema26[i - offset]));
  }

  if (macdLine.length < 9) return null;

  const signalLine = computeEMA(macdLine, 9);
  const histOffset = macdLine.length - signalLine.length;
  const histogram: Decimal[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + histOffset].minus(signalLine[i]));
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

function computeBollingerBands(closes: Decimal[], period = 20, stdDev = 2): {
  upper: Decimal;
  middle: Decimal;
  lower: Decimal;
  width: Decimal;
} | null {
  if (closes.length < period) return null;

  const recent = closes.slice(-period);
  let sum = new Decimal(0);
  for (const v of recent) sum = sum.plus(v);
  const sma = sum.div(period);

  let variance = new Decimal(0);
  for (const v of recent) variance = variance.plus(v.minus(sma).pow(2));
  const std = variance.div(period).sqrt();

  const upper = sma.plus(std.mul(stdDev));
  const lower = sma.minus(std.mul(stdDev));
  const width = upper.minus(lower).div(sma).mul(100);

  return { upper, middle: sma, lower, width };
}

// ============================================
// Analysis
// ============================================

interface DetailAnalysis {
  coin: string;
  price: string;
  change24h: string;
  funding: string;
  fundingAnnualized: string;
  volume24h: string;
  openInterest: string;
  oraclePrice: string;
  rsi4h: number | null;
  rsi1h: number | null;
  macdSignal: string | null;
  bollingerPosition: string | null;
  bollingerWidth: string | null;
  ema7: string | null;
  ema25: string | null;
  trendAlignment: string;
  suggestion: string;
  category: string;
}

async function fetchCandles(
  client: InfoClient,
  coin: string,
  interval: '1h' | '4h',
  count: number,
  dexOpt: Record<string, string>,
): Promise<CandleSnapshotResponse> {
  const intervalMs = interval === '4h' ? 4 * 60 * 60 * 1000 : 60 * 60 * 1000;
  const now = Date.now();
  const startTime = now - intervalMs * count;
  const candles = await client.candleSnapshot({
    coin,
    interval,
    startTime,
    endTime: now,
    ...dexOpt,
  } as any);
  return (candles || []).sort((a, b) => a.t - b.t);
}

async function analyzeAsset(
  client: InfoClient,
  coin: string,
): Promise<DetailAnalysis> {
  const assetInfo = await getAssetInfo(client, coin);
  const apiCoin = assetInfo.coin;
  const dexOpt = dexNameToOpt(assetInfo.dexName);

  const [meta, assetCtxs] = await client.metaAndAssetCtxs(dexOpt as any);
  const idx = meta.universe.findIndex((a) => a.name.toUpperCase() === apiCoin.toUpperCase());
  const actx = idx !== -1 ? assetCtxs[idx] : undefined;

  if (!actx) throw new Error(`Unknown coin: ${coin}`);
  const markPx = new Decimal(actx.markPx);
  const prevDayPx = new Decimal(actx.prevDayPx);
  const change24h = markPx.minus(prevDayPx).div(prevDayPx).mul(100);
  const funding = new Decimal(actx.funding);
  const fundingAnn = funding.mul(24 * 365 * 100);
  const dayNtlVlm = new Decimal(actx.dayNtlVlm);
  const openInterest = new Decimal(actx.openInterest);

  // Fetch candles
  const [candles4h, candles1h] = await Promise.all([
    fetchCandles(client, apiCoin, '4h', 30, dexOpt),
    fetchCandles(client, apiCoin, '1h', 50, dexOpt),
  ]);

  const closes4h = candles4h.map((c) => new Decimal(c.c));
  const closes1h = candles1h.map((c) => new Decimal(c.c));

  // Indicators
  const rsi4h = computeRSI(closes4h);
  const rsi1h = computeRSI(closes1h);
  const macd = computeMACD(closes1h);
  const bb = computeBollingerBands(closes1h);

  const ema7Arr = computeEMA(closes1h, 7);
  const ema25Arr = computeEMA(closes1h, 25);
  const ema7 = ema7Arr.length > 0 ? ema7Arr[ema7Arr.length - 1] : null;
  const ema25 = ema25Arr.length > 0 ? ema25Arr[ema25Arr.length - 1] : null;

  // MACD signal
  let macdSignal: string | null = null;
  if (macd && macd.histogram.length >= 2) {
    const last = macd.histogram[macd.histogram.length - 1];
    const prev = macd.histogram[macd.histogram.length - 2];
    if (last.gt(0) && prev.lte(0)) macdSignal = 'Bullish crossover';
    else if (last.lt(0) && prev.gte(0)) macdSignal = 'Bearish crossover';
    else if (last.gt(0)) macdSignal = 'Bullish';
    else macdSignal = 'Bearish';
  }

  // Bollinger position
  let bollingerPosition: string | null = null;
  let bollingerWidth: string | null = null;
  if (bb) {
    bollingerWidth = `${bb.width.toFixed(2)}%`;
    if (markPx.gte(bb.upper)) bollingerPosition = 'Above upper band (overbought)';
    else if (markPx.lte(bb.lower)) bollingerPosition = 'Below lower band (oversold)';
    else {
      const pct = markPx.minus(bb.lower).div(bb.upper.minus(bb.lower)).mul(100);
      bollingerPosition = `${pct.toFixed(0)}% (mid-band)`;
    }
  }

  // Trend alignment
  const signals: string[] = [];
  if (change24h.gt(0)) signals.push('momentum+');
  else signals.push('momentum-');
  if (rsi4h !== null && rsi4h < 30) signals.push('RSI_oversold');
  else if (rsi4h !== null && rsi4h > 70) signals.push('RSI_overbought');
  if (macdSignal?.includes('Bullish')) signals.push('MACD+');
  else if (macdSignal?.includes('Bearish')) signals.push('MACD-');
  if (ema7 && ema25) {
    if (ema7.gt(ema25)) signals.push('EMA+');
    else signals.push('EMA-');
  }

  const bullish = signals.filter((s) => s.endsWith('+') || s.includes('oversold')).length;
  const bearish = signals.filter((s) => s.endsWith('-') || s.includes('overbought')).length;

  let trendAlignment: string;
  let suggestion: string;
  let category: string;

  if (bullish >= 3) {
    trendAlignment = 'Strong bullish';
    suggestion = `Multiple indicators aligned bullish. Consider Long ${apiCoin}.`;
    category = bullish >= 4 ? 'aggressive' : 'moderate';
  } else if (bearish >= 3) {
    trendAlignment = 'Strong bearish';
    suggestion = `Multiple indicators aligned bearish. Consider Short ${apiCoin}.`;
    category = bearish >= 4 ? 'aggressive' : 'moderate';
  } else if (bullish > bearish) {
    trendAlignment = 'Mildly bullish';
    suggestion = `Slight bullish bias. Conservative Long may be considered with tight stop.`;
    category = 'conservative';
  } else if (bearish > bullish) {
    trendAlignment = 'Mildly bearish';
    suggestion = `Slight bearish bias. Conservative Short may be considered with tight stop.`;
    category = 'conservative';
  } else {
    trendAlignment = 'Neutral / mixed';
    suggestion = 'No clear directional signal. Wait for confirmation.';
    category = 'conservative';
  }

  return {
    coin: apiCoin,
    price: markPx.toSignificantDigits(6).toString(),
    change24h: `${change24h.toFixed(2)}%`,
    funding: funding.toString(),
    fundingAnnualized: `${fundingAnn.toFixed(1)}%`,
    volume24h: `$${dayNtlVlm.div(1e6).toFixed(2)}M`,
    openInterest: `$${openInterest.div(1e6).toFixed(2)}M`,
    oraclePrice: new Decimal(actx.oraclePx).toSignificantDigits(6).toString(),
    rsi4h,
    rsi1h,
    macdSignal,
    bollingerPosition,
    bollingerWidth,
    ema7: ema7?.toSignificantDigits(6).toString() ?? null,
    ema25: ema25?.toSignificantDigits(6).toString() ?? null,
    trendAlignment,
    suggestion,
    category,
  };
}

// ============================================
// Display
// ============================================

function formatDetailText(a: DetailAnalysis): void {
  console.log(chalk.bold(`\nSignal Detail: ${a.coin}\n`));

  const catColor = a.category === 'aggressive' ? chalk.red
    : a.category === 'moderate' ? chalk.yellow
    : chalk.green;

  const section = (title: string) => console.log(chalk.cyan.bold(`  ${title}`));
  const row = (label: string, value: string) =>
    console.log(`    ${chalk.gray(label.padEnd(22))} ${value}`);

  section('Market Data');
  row('Price', a.price);
  row('Oracle Price', a.oraclePrice);
  row('24h Change', a.change24h);
  row('Funding (1h)', a.funding);
  row('Funding (annualized)', a.fundingAnnualized);
  row('24h Volume', a.volume24h);
  row('Open Interest', a.openInterest);
  console.log('');

  section('Technical Indicators');
  const fmtRsi = (v: number | null) => {
    if (v === null) return chalk.gray('-');
    const s = v.toFixed(1);
    return v < 30 ? chalk.green(s + ' (oversold)') : v > 70 ? chalk.red(s + ' (overbought)') : chalk.white(s);
  };
  row('RSI (4h)', fmtRsi(a.rsi4h));
  row('RSI (1h)', fmtRsi(a.rsi1h));
  row('MACD', a.macdSignal ?? chalk.gray('-'));
  row('Bollinger Position', a.bollingerPosition ?? chalk.gray('-'));
  row('Bollinger Width', a.bollingerWidth ?? chalk.gray('-'));
  row('EMA 7 (1h)', a.ema7 ?? chalk.gray('-'));
  row('EMA 25 (1h)', a.ema25 ?? chalk.gray('-'));
  console.log('');

  section('Assessment');
  row('Trend', a.trendAlignment);
  row('Category', catColor(a.category));
  console.log('');
  console.log(`  ${chalk.bold('Suggestion:')} ${a.suggestion}`);
  console.log('');
  console.log(chalk.gray('  Disclaimer: Signals are for reference only. Not financial advice. DYOR.'));
  console.log('');
}

// ============================================
// Command
// ============================================

export function registerDetailCommand(signal: Command): void {
  signal
    .command('detail')
    .description('Show detailed signal analysis for a specific coin')
    .argument('<coin>', 'Coin symbol (e.g., BTC, ETH, xyz:gold, xyz gold)')
    .allowExcessArguments()
    .action(async function (this: Command, coin: string) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);

      try {
        const client = ctx.getPublicClient();

        const excessArgs = this.args.slice(1);
        let resolvedCoin = coin;
        if (excessArgs.length > 0 && isKnownDex(coin)) {
          resolvedCoin = `${coin}:${excessArgs[0]}`;
        }

        const analysis = await analyzeAsset(client, resolvedCoin);

        if (outputOpts.json) {
          output(analysis, outputOpts);
        } else {
          formatDetailText(analysis);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'SIGNAL_ERROR');
        process.exit(1);
      }
    });
}
