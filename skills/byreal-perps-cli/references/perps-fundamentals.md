# Perpetual Futures Fundamentals

Reference for the AI agent. Internalize these concepts before executing any perps command.

## Markets (DEXes)

`byreal-perps-cli` aggregates across two perp markets on Hyperliquid:

- **`main`** — the Hyperliquid main perp universe. BTC, ETH, SOL, and the long-tail of standard perps live here.
- **`xyz`** — a HIP-3 sub-DEX. Hosts assets not available on the main market (e.g. `GOLD`). Same wallet address, but **separate margin pool** — cross-margin positions on xyz do NOT share collateral with cross-margin positions on main. `account info` sums per-DEX balances for the aggregate view.

### Coin symbol syntax

Two forms:

- **Explicit prefix (preferred)**: `main:BTC`, `main:ETH`, `xyz:GOLD`, `xyz GOLD` (space form; CLI recombines split args)
- **Bare symbol (legacy)**: `BTC`, `ETH`, `GOLD`

**Always use the explicit prefix when calling the CLI.** Bare symbols work but trigger silent routing behavior that can hide which market the order actually hit.

### Bare ticker resolution — silent routing hazard

A bare symbol is NOT restricted to main. The CLI searches both universes and returns the first match in DEX registry order (`main` before `xyz`). Two cases to know:

1. **Same ticker on both markets** → CLI silently picks main. If the user meant xyz, the order lands on the wrong market with no warning.
2. **Ticker only on xyz** → CLI silently falls back to xyz. The user may not even know xyz exists.

The only path that actually reports an error is "ticker on neither market" → `Unknown coin`.

Explicit prefix (`main:BTC`, `xyz:GOLD`) bypasses this entirely — the CLI routes exactly where you told it.

### Aggregation behavior

These commands automatically query both DEXes and merge results — the user does not need to specify which market:

- `position list` — returns positions from both, each row tagged with its DEX
- `account info` — `totalNtlPos`, `totalMarginUsed`, etc. are summed across both
- `order list` / `order cancel` / `order cancel-all` — fan out across both
- `position close-all` — closes positions on both
- `signal scan` / `signal detail` — cover both universes

Targeted commands (`order market`, `order limit`, `position leverage`, `position margin-mode`, `position tpsl`, `position close-market`, `position close-limit`) route by the coin argument — whoever owns that symbol gets the call.

### When to surface market info to the user

- Before running any targeted command (order / leverage / margin-mode / tpsl / close), show the user which market will be hit: `Market: main` or `Market: xyz`
- If the user names a coin ambiguously (could be either market) → list both candidates and ask; don't guess
- Showing position list when both markets have positions → keep the DEX column so the user can tell them apart
- Always pass the full prefixed form (`main:BTC`, `xyz:GOLD`) to the CLI, never bare

## Core Triangle: Notional / Margin / Leverage

Three values, always linked by one formula:

    notional_value = margin × leverage

- **Notional value** — the total USD exposure of a position. This is what the user means by "position size" or "$X position".
- **Margin** — the collateral locked to hold the position. This is what the user means by "$X margin".
- **Leverage** — the multiplier. 10x leverage means $100 margin controls $1,000 notional.

Examples:

| User says | Notional | Leverage | Margin needed |
|---|---|---|---|
| "$20 position" | $20 | (current setting) | $20 / leverage |
| "$20 position, 5x leverage" | $20 | 5x | $4 |
| "$10 margin, 2x" | $20 | 2x | $10 |

## CLI Size Parameter

`byreal-perps-cli order market <side> <size> <coin>`

`size` is in coin units. Its USD value (`size × current_price`) equals the position notional. Margin required = `notional / leverage`.

To convert a USD amount to coin units:

    size_in_coins = usd_notional / current_price

Example: User wants $20 ETH position, ETH price is $2,342:

    size = $20 / $2,342 = 0.00854 ETH

WRONG: `$20 / $2,342 / leverage` — this gives margin-equivalent coins, not notional.

## Leverage Lifecycle

Leverage is a per-coin account setting, NOT a per-order parameter.

1. **Check current leverage**: `byreal-perps-cli position list` shows leverage per open position. For coins with no open position, the CLI cannot query the current setting — just call `position leverage <coin> <leverage>` before ordering to ensure the desired value.
2. **Set before ordering**: `byreal-perps-cli position leverage <coin> <leverage>` — MUST run this BEFORE placing an order if the desired leverage differs from current setting. Valid range: **1–50x**. Default when never set: **1x**.

## Margin Modes

Margin mode is per-coin. Set via `position leverage <coin> <lev>` (`--cross` default, `--isolated` to switch) or `position margin-mode <coin> <mode>`. Different coins on the same account can use different modes.

### Cross Margin (default)
- Cross-mode positions share one margin pool. Unrealized profit from one can offset another's margin requirement.
- Liquidation cascades: losses on one cross position draw from the shared pool, which can liquidate other cross positions.
- Isolated positions on the same account are NOT part of this pool.

### Isolated Margin
- Each isolated position has its own dedicated margin.
- Maximum loss per position = its isolated margin. Liquidation of one isolated position does not affect others.
- **Margin cannot be adjusted after opening** — this CLI has no `add-margin` / `update-isolated-margin` command. To change an isolated position's margin, close and reopen.

### Asset-level restrictions
Some coins are `onlyIsolated` (cross not allowed). `position margin-mode <coin> cross` on such coins returns `MARGIN_MODE_ERROR`.

### Mode choice guidance
- Small / experimental / single directional trade → isolated (bounded loss)
- Multiple offsetting positions → cross (pooled margin is capital-efficient)

### Querying account-wide leverage
Run `byreal-perps-cli account info -o json`. Fields returned include `accountValue`, `totalNtlPos`, `totalMarginUsed`, `maintenanceMarginUsed`, `withdrawable`, `availableMargin`. Aggregate account leverage ≈ `totalNtlPos / accountValue`. Per-coin leverage is in `position list` output.

### Switching mode
`byreal-perps-cli position margin-mode <coin> <mode>` — run when no open position exists for that coin.

## Funding Rate

Perpetual futures have no expiry date. Funding rate keeps the perp price anchored to spot.

- **Positive funding rate**: Longs pay shorts. Market is bullish (perp premium over spot).
- **Negative funding rate**: Shorts pay longs. Market is bearish (perp discount to spot).
- **Rate display**: the `funding_rate` shown is the **8-hour rate**.
- **Settlement**: funding is paid **every hour** at **1/8 of the displayed rate**.
- **Annualized rate**: `funding_rate × 3 × 365` (3 × 8h windows per day).

When users mention "interest" in perps context, they mean funding rate.

## Liquidation

**Maintenance margin (MM)** is the minimum collateral required to keep a position open. `maintenance_margin = notional × mmr`, where `mmr` is the maintenance margin ratio set per asset (typically 1–2%).

**Initial margin** is what you lock when opening (`notional / leverage`). It's always larger than maintenance margin — the gap is your safety buffer before liquidation triggers.

The CLI exposes `maintenanceMarginUsed` in `account info` output.

When your position's margin falls below the maintenance margin requirement, the exchange force-closes your position.

- **Liquidation price** depends on: entry price, leverage, margin mode, position size
- Higher leverage = closer liquidation price to entry = higher risk
- In cross mode: other positions' PnL affects your effective margin
- The CLI shows `liquidationPx` in `position list` output — always surface this to the user when opening positions (see SKILL.md for the behavior rule)

## Common User Intents → Correct Actions

| User says | Correct interpretation |
|---|---|
| "$20 position" | Notional = $20, size = $20/price |
| "$20 margin" | Margin = $20, notional = $20 × leverage |
| "10x leverage" | Set leverage to 10 before ordering |
| "go long" | `order market long` or `order market buy` |
| "go short" | `order market short` or `order market sell` |
| "add to position" | New order same direction, adds to existing position |
| "reduce position" | Partial close: `position close-market <coin> --size <partial>` |
| "close all" | `position close-all -y` |
| "show positions" | `position list` |
| "stop-loss / take-profit" | See TP/SL section in SKILL.md |
