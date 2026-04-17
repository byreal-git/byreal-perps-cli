import Decimal from 'decimal.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError } from '../../cli/output.js';
import type { InfoClient } from '@nktkas/hyperliquid';

// ============================================
// Types
// ============================================

interface AssetMarketData {
  coin: string;
  markPx: Decimal;
  prevDayPx: Decimal;
  funding: Decimal;
  dayNtlVlm: Decimal;
  openInterest: Decimal;
  oraclePx: Decimal;
  change24h: Decimal;
}

interface AssetSignal extends AssetMarketData {
  rsi: number | null;
  direction: 'Long' | 'Short';
  score: number;
  category: 'conservative' | 'moderate' | 'aggressive';
}

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
  const rsi = new Decimal(100).minus(new Decimal(100).div(rs.plus(1)));
  return rsi.toNumber();
}

async function fetchRSI(
  client: InfoClient,
  coin: string,
): Promise<number | null> {
  try {
    const now = Date.now();
    const startTime = now - 4 * 60 * 60 * 1000 * 20; // 20 x 4h candles
    const candles = await client.candleSnapshot({
      coin,
      interval: '4h',
      startTime,
      endTime: now,
    });
    if (!candles || candles.length < 15) return null;

    const closes = candles
      .sort((a, b) => a.t - b.t)
      .map((c) => new Decimal(c.c));

    return computeRSI(closes);
  } catch {
    return null;
  }
}

// ============================================
// Scoring
// ============================================

function scoreAsset(data: AssetMarketData, rsi: number | null): AssetSignal {
  const change = data.change24h.toNumber();
  const funding = data.funding.toNumber();
  const volume = data.dayNtlVlm.toNumber();

  // Determine direction
  const direction: 'Long' | 'Short' = change >= 0 ? 'Long' : 'Short';
  const isLong = direction === 'Long';

  // --- Score components (0-100 each) ---

  // 1. Momentum score: absolute change matters, capped at 15%
  const absChange = Math.abs(change);
  const momentumScore = Math.min(absChange / 15, 1) * 100;

  // 2. Funding score: for longs, negative funding is good; for shorts, positive is good
  const fundingAnnualized = funding * 24 * 365; // hourly rate to annualized
  const fundingScore = isLong
    ? Math.max(0, Math.min(1, (0.3 - fundingAnnualized) / 0.6)) * 100
    : Math.max(0, Math.min(1, (fundingAnnualized + 0.3) / 0.6)) * 100;

  // 3. Volume score: log-scaled, $1M = 30, $10M = 60, $100M = 90
  const volScore = Math.min(Math.max(0, Math.log10(Math.max(volume, 1)) - 4) / 4 * 100, 100);

  // 4. RSI score: for longs, oversold is good; for shorts, overbought is good
  let rsiScore = 50; // neutral if no RSI
  if (rsi !== null) {
    if (isLong) {
      // RSI 30 = 100pts, RSI 50 = 60pts, RSI 70 = 20pts, RSI 85+ = 0pts
      rsiScore = Math.max(0, Math.min(100, (85 - rsi) / 55 * 100));
    } else {
      // RSI 70 = 100pts, RSI 50 = 60pts, RSI 30 = 20pts, RSI 15- = 0pts
      rsiScore = Math.max(0, Math.min(100, (rsi - 15) / 55 * 100));
    }
  }

  // Composite: weighted sum
  const score =
    momentumScore * 0.3 +
    fundingScore * 0.2 +
    volScore * 0.25 +
    rsiScore * 0.25;

  // Categorize
  let category: AssetSignal['category'];
  if (score >= 65) {
    category = 'aggressive';
  } else if (score >= 45) {
    category = 'moderate';
  } else {
    category = 'conservative';
  }

  // Refine category by volatility and RSI
  if (rsi !== null) {
    if ((rsi < 25 || rsi > 75) && absChange > 5) {
      category = 'aggressive';
    } else if (rsi >= 40 && rsi <= 60 && absChange < 3 && volScore > 50) {
      category = 'conservative';
    }
  }

  return { ...data, rsi, direction, score, category };
}

// ============================================
// Display
// ============================================

const CATEGORY_LABELS: Record<string, string> = {
  conservative: '稳健 Conservative',
  moderate: '平稳 Moderate',
  aggressive: '进取 Aggressive',
};

const CATEGORY_COLORS: Record<string, (s: string) => string> = {
  conservative: chalk.green,
  moderate: chalk.yellow,
  aggressive: chalk.red,
};

function formatSignalText(signals: AssetSignal[], top: number): void {
  if (signals.length === 0) {
    console.log(chalk.gray('No signals found'));
    return;
  }

  console.log(chalk.bold('\nPerps Signal Scanner\n'));

  for (const cat of ['conservative', 'moderate', 'aggressive'] as const) {
    const items = signals
      .filter((s) => s.category === cat)
      .sort((a, b) => b.score - a.score)
      .slice(0, top);

    if (items.length === 0) continue;

    const color = CATEGORY_COLORS[cat];
    console.log(color(`--- ${CATEGORY_LABELS[cat]} ---`));
    console.log('');

    for (const s of items) {
      const dir = s.direction === 'Long'
        ? chalk.green.bold('LONG ')
        : chalk.red.bold('SHORT');
      const change = s.change24h.toNumber();
      const changeStr = change >= 0
        ? chalk.green(`+${change.toFixed(2)}%`)
        : chalk.red(`${change.toFixed(2)}%`);
      const fundingAnn = (s.funding.toNumber() * 365 * 3 * 100).toFixed(1);
      const fundingStr = s.funding.gte(0) ? chalk.red(`${fundingAnn}%`) : chalk.green(`${fundingAnn}%`);
      const rsiStr = s.rsi !== null ? s.rsi.toFixed(1) : '-';
      const rsiColor = s.rsi !== null
        ? (s.rsi < 30 ? chalk.green : s.rsi > 70 ? chalk.red : chalk.white)
        : chalk.gray;
      const volM = s.dayNtlVlm.div(1e6).toFixed(1);
      const oiM = s.openInterest.div(1e6).toFixed(1);
      const scoreStr = chalk.bold(s.score.toFixed(0));

      console.log(
        `  ${dir} ${chalk.bold.white(s.coin.padEnd(10))} ` +
        `Price: ${chalk.white(s.markPx.toSignificantDigits(6).toString().padEnd(12))} ` +
        `24h: ${changeStr.padEnd(18)} ` +
        `RSI: ${rsiColor(rsiStr.padEnd(6))} ` +
        `Funding: ${fundingStr.padEnd(18)} ` +
        `Vol: $${volM}M  OI: $${oiM}M  ` +
        `Score: ${scoreStr}`,
      );
    }
    console.log('');
  }

  // Summary
  const longCount = signals.filter((s) => s.direction === 'Long').length;
  const shortCount = signals.filter((s) => s.direction === 'Short').length;
  const avgFunding = signals.reduce((sum, s) => sum + s.funding.toNumber(), 0) / signals.length;
  const sentiment = avgFunding > 0.00005 ? 'Bullish (longs paying)' : avgFunding < -0.00005 ? 'Bearish (shorts paying)' : 'Neutral';

  console.log(chalk.bold('Summary'));
  console.log(`  Scanned: ${signals.length} assets  |  Long: ${longCount}  Short: ${shortCount}  |  Market sentiment: ${sentiment}`);
  console.log('');
  console.log(chalk.gray('  Disclaimer: Signals are for reference only. Not financial advice. DYOR.'));
  console.log('');
}

function buildJsonOutput(signals: AssetSignal[], top: number) {
  const grouped: Record<string, unknown[]> = {
    conservative: [],
    moderate: [],
    aggressive: [],
  };

  for (const cat of ['conservative', 'moderate', 'aggressive'] as const) {
    grouped[cat] = signals
      .filter((s) => s.category === cat)
      .sort((a, b) => b.score - a.score)
      .slice(0, top)
      .map((s) => ({
        coin: s.coin,
        direction: s.direction,
        price: s.markPx.toString(),
        change24h: `${s.change24h.toFixed(2)}%`,
        rsi: s.rsi !== null ? Number(s.rsi.toFixed(1)) : null,
        funding: s.funding.toString(),
        fundingAnnualized: `${(s.funding.toNumber() * 365 * 3 * 100).toFixed(1)}%`,
        dayVolume: s.dayNtlVlm.toString(),
        openInterest: s.openInterest.toString(),
        score: Number(s.score.toFixed(1)),
        category: s.category,
      }));
  }

  return {
    signals: grouped,
    summary: {
      scanned: signals.length,
      long: signals.filter((s) => s.direction === 'Long').length,
      short: signals.filter((s) => s.direction === 'Short').length,
    },
  };
}

// ============================================
// Command
// ============================================

export function registerScanCommand(signal: Command): void {
  signal
    .command('scan')
    .description('Scan markets for trading signals (conservative / moderate / aggressive)')
    .option('--top <n>', 'Max signals per category', '5')
    .option('--min-volume <usd>', 'Min 24h volume in USD (default: 1000000)', '1000000')
    .action(async function (this: Command, opts: { top: string; minVolume: string }) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);
      const topN = parseInt(opts.top, 10) || 5;
      const minVol = new Decimal(opts.minVolume);

      try {
        const client = ctx.getPublicClient();

        // Fetch meta + asset contexts (main + xyz)
        const [
          [meta, assetCtxs],
          [xyzMeta, xyzAssetCtxs],
        ] = await Promise.all([
          client.metaAndAssetCtxs(),
          client.metaAndAssetCtxs({ dex: 'xyz' }),
        ]);

        // Build market data array
        const marketData: AssetMarketData[] = [];

        const sources: { universe: typeof meta.universe; ctxs: typeof assetCtxs }[] = [
          { universe: meta.universe, ctxs: assetCtxs },
          { universe: xyzMeta.universe, ctxs: xyzAssetCtxs },
        ];

        for (const { universe, ctxs } of sources) {
          for (let i = 0; i < universe.length; i++) {
            const asset = universe[i];
            const actx = ctxs[i];
            if (!actx) continue;

            const markPx = new Decimal(actx.markPx || '0');
            const prevDayPx = new Decimal(actx.prevDayPx || '0');
            const dayNtlVlm = new Decimal(actx.dayNtlVlm || '0');

            if (markPx.isZero() || prevDayPx.isZero()) continue;
            if (dayNtlVlm.lt(minVol)) continue;

            const change24h = markPx.minus(prevDayPx).div(prevDayPx).mul(100);

            marketData.push({
              coin: asset.name,
              markPx,
              prevDayPx,
              funding: new Decimal(actx.funding || '0'),
              dayNtlVlm,
              openInterest: new Decimal(actx.openInterest || '0'),
              oraclePx: new Decimal(actx.oraclePx || '0'),
              change24h,
            });
          }
        }

        // Sort by volume desc, take top 30 for RSI computation
        marketData.sort((a, b) => b.dayNtlVlm.cmp(a.dayNtlVlm));
        const candidates = marketData.slice(0, 30);

        // Fetch RSI for candidates in parallel (batched)
        const BATCH_SIZE = 6;
        const rsiMap = new Map<string, number | null>();

        for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
          const batch = candidates.slice(i, i + BATCH_SIZE);
          const results = await Promise.all(
            batch.map((d) => fetchRSI(client, d.coin)),
          );
          for (let j = 0; j < batch.length; j++) {
            rsiMap.set(batch[j].coin, results[j]);
          }
        }

        // Score and categorize
        const signals: AssetSignal[] = candidates.map((d) =>
          scoreAsset(d, rsiMap.get(d.coin) ?? null),
        );

        // Output
        if (outputOpts.json) {
          output(buildJsonOutput(signals, topN), outputOpts);
        } else {
          formatSignalText(signals, topN);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts, 'SIGNAL_ERROR');
        process.exit(1);
      }
    });
}
