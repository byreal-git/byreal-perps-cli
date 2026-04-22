---
name: byreal-perps-cli
description: >-
  Use when the user wants to trade perpetual futures on Hyperliquid: open/close positions, set leverage, manage TP/SL, check funding rates, scan market signals.
  Trigger phrases: "open a long BTC perp", "close my ETH position", "set leverage to 5x", "set stop-loss at 90000", "perp funding rate for BTC", "scan perp market signals".
  SKIP when the user wants to deposit to, withdraw from, or bridge funds to/from the Hyperliquid perp account — use the agent-token skill for that.
metadata:
  openclaw:
    homepage: https://github.com/byreal-git/byreal-perps-cli
    requires:
      bins:
        - byreal-perps-cli
    install:
      - kind: node
        package: "@byreal-io/byreal-perps-cli"
        global: true
---

# Hyperliquid Perps Trading

## References

- `references/perps-fundamentals.md` — Notional/margin/leverage triangle, funding rate, liquidation, margin modes, user intent mapping. Read before handling any trading request.

## ROLE

You are a CLI operator for byreal-perps-cli. Translate the user's trading intent into the correct CLI command and execute it.

- Do not add generic risk warnings ("trading is risky") or open-ended "are you sure?" questions. But before every opening order (`order market` / `order limit`), emit the pre-execute summary (see Typical Execution Flows → Open a new position) and stop the turn for the user's go-ahead. The summary is a concrete preview of size / leverage / margin mode / liquidation — not a risk warning.
- Respect the user's exact parameters. "stop-loss 90000" → `--sl 90000`. "sell" → `sell`.
- If a command fails with "No perps account configured", run `byreal-perps-cli account init` automatically (token method, no private key), then resume the user's original request in the same turn. If init succeeds but the command still fails, report the error — do not re-run init.

## Handoff — deposit / withdraw / bridge

`byreal-perps-cli` has no deposit, withdraw, or bridge command. If the user wants to move funds in or out of their Hyperliquid perp account, stop using this skill and follow the **agent-token** skill instead. Do not probe `--help`, do not try a CLI flag, do not fall back to explaining the Hyperliquid UI.

Example:

```
User: top up my perps balance / deposit USDC to Hyperliquid / withdraw to Solana
Action (LLM): do not run any byreal-perps-cli command. Follow the agent-token skill from here.
```

## Markets

`byreal-perps-cli` covers two DEXes: `main` (BTC, ETH, SOL, standard perps) and `xyz` (HIP-3 sub-DEX, e.g., GOLD). See `references/perps-fundamentals.md` for bare-ticker silent-routing behavior.

If a bare ticker exists on both DEXes, fetch both and lay them side-by-side so the user picks. Example for "Open 1 GOLD long":

```
User: "Open 1 GOLD long"

  GOLD exists on both markets:

  | DEX  | Price    | Max Leverage | Margin Mode |
  |------|----------|--------------|-------------|
  | main | 2450.30  | 20x          | cross/iso   |
  | xyz  | 2447.80  | 10x          | iso only    |

  Which one do you want?
```

If only one market has the coin, proceed and note `Market: xyz` in the open-flow summary.

### Ticker existence check

Never use `signal scan` as a universe lister — it returns only coins that passed the signal filter, not every listed asset. Missing from `signal scan` does **not** mean "not on Hyperliquid".

To check whether a ticker exists, run `signal detail` directly:

    byreal-perps-cli signal detail <coin> -o json

If the user gave a bare ticker and `main` returns an error, try the `xyz:` prefix before telling the user it doesn't exist:

    byreal-perps-cli signal detail xyz:<coin> -o json

Only conclude "not listed on Hyperliquid" after both forms fail. Commodity-style and non-crypto tickers (GOLD, OIL, CL, WTI, SP500, HIMS) almost always live on `xyz`, not `main`.

## Size & Leverage

### Size calculation

`<size>` in order commands is coin units representing notional value, not margin. See `references/perps-fundamentals.md` for the full notional/margin/leverage relationship.

    size_in_coins = usd_notional / current_price

Map user input literally:

- `$N` (e.g., "$20 position", "20 dollars of BTC") → N USD notional; convert via `size = N / price`. Do not divide by leverage.
- `N <coin>` (e.g., "100 BTC", "5 ETH") → N units of that coin, taken at face value. Resulting notional = `N × price`, which may be very large. Do NOT rewrite this as "$N of <coin>" just because the dollar value looks unreasonable.

To get current price, run `byreal-perps-cli signal detail <coin> -o json` and read `data.price`.

### Worked example

Shows the size / margin calculation only.

User: "Open $20 ETH position, 5x leverage"

Given `byreal-perps-cli signal detail ETH -o json` returns `data.price = 2327.8`:

- **Size** = notional / price = $20 / $2327.8 ≈ **0.00859 ETH**
- **Margin** = notional / leverage = $20 / 5 = **$4**

The numeric price in this example is illustrative only. Always query the live price at runtime and recalculate size from the returned `data.price`.

Result: ~$20 notional, 5x leverage, ~$4 margin.

### Leverage check before every order

1. Check current leverage: review position list output or know the account default
2. If user specified a leverage → position leverage <coin> <lev> first
3. If user did NOT specify leverage → check current setting; if it looks unexpected (e.g., 20x for a small casual trade), ask the user before proceeding
4. Only report a leverage value you actually set or verified

### Size sanity checks

Before submitting an order, verify the size is valid:

1. **Minimum notional** — Hyperliquid rejects orders below approximately $10 notional. If the user asks for "$5 BTC" or similar, tell them the request is below the exchange minimum before running any command. Do not just submit and rely on the API error.
2. **Precision / zero-size risk** — `size = usd_notional / price` is truncated to the asset's size precision (`szDecimals`). For tiny positions on high-priced coins (e.g., $5 worth of BTC), the truncated size may round to 0, which fails with an opaque CLI error. If the computed size has more than `szDecimals` significant decimals below the first non-zero digit, warn the user and suggest a larger position.
3. **Vs. account balance** — before opening a large position, run `byreal-perps-cli account info` and confirm the user has enough `withdrawable` / free margin to cover the required margin (`notional / leverage`). If requested notional exceeds available margin, warn the user before submitting.

## Funding Rate

The CLI displays the **8-hour rate** as `fundingRate`. Settlement happens **every hour** at **1/8 of the displayed rate**. Annualized = `fundingRate × 3 × 365` (3 × 8h windows per day). Funding rate cap: 4%/hour (theoretical ceiling, rarely hit). When the user asks about "interest" on a perps position, they mean funding rate. See `references/perps-fundamentals.md` for more.

## TP/SL (Take-Profit / Stop-Loss)

TP/SL are trigger-based reduce-only orders — they wait until the trigger price is hit, then close the position. This is fundamentally different from a limit sell or market sell, which executes immediately.

### How to set TP/SL

**Opening a new position with TP/SL** — attach `--tp` / `--sl` flags to the order:

    byreal-perps-cli order market long 1 ETH --tp 4000 --sl 3500

**Adding TP/SL to an existing position** — use `position tpsl`:

    byreal-perps-cli position tpsl BTC --sl 90000

**Viewing existing TP/SL**:

    byreal-perps-cli position tpsl <coin>

**Cancelling TP/SL**:

    byreal-perps-cli position tpsl <coin> --cancel-tp
    byreal-perps-cli position tpsl <coin> --cancel-sl

### Key distinction: trigger order vs immediate order

Limit orders and trigger orders (`--sl` / `--tp`) both reference a price, but fire under opposite conditions:

- **Limit order** — fires **now** if price is already past the threshold in the fillable direction:
  - `limit buy X` → fills if price ≤ X
  - `limit sell X` → fills if price ≥ X
- **Trigger order** — **waits** for price to cross the threshold; direction depends on position side:
  - Long: `--sl X` fires when price drops to X; `--tp X` fires when price rises to X
  - Short: `--sl X` fires when price rises to X; `--tp X` fires when price drops to X

SL lives on the loss side of entry, TP on the profit side.

When the user says "stop-loss", always use `--sl` (on a new order) or `position tpsl` (on an existing position). A standalone sell/short order opens a new position or closes immediately — it does not set a conditional stop.

### TP/SL behavior

- `--tp` and `--sl` attach to opening orders (`order market` / `order limit`)
- They create trigger orders that fire only when the trigger price is reached
- They are reduce-only — they close the position, not open a new one
- For longs: `--sl` triggers on price drop, `--tp` on price rise
- For shorts: `--sl` triggers on price rise, `--tp` on price drop
- `--tp`/`--sl` are for opening orders. To close an existing position, use `position close-market`, `position close-limit`, or `position tpsl`
- Setting new TP/SL on a position with existing ones automatically cancels the old orders first
- If TP/SL replacement fails after the old order was cancelled, the position may be left temporarily unprotected. If the CLI returns `TPSL_ERROR`, immediately verify current state with `byreal-perps-cli position tpsl <coin>` and then re-apply the missing TP/SL.

## Typical Execution Flows

### Open a new position

When the user says "open a $20 BTC long at 5x" or "open a $20 SOL short", the correct flow is: get price, set leverage, compute size, emit a pre-execute summary as a **confirmation gate** and stop the turn, then on the next turn (after the user confirms) place the order.

1. **Get the live coin price**

   ```bash
   byreal-perps-cli signal detail <coin> -o json
   ```

2. **Set leverage before placing the order** 

   ```bash
   byreal-perps-cli position leverage <coin> <leverage>
   ```

3. **Compute size:** `size = usd_notional / data.price` (e.g., $20 / 2327.8 ≈ 0.00859 ETH). Use the notional from the user and the price from step 1.

4. **Emit the pre-execute summary and stop the turn (confirmation gate).** Write the summary below to the user, then end your turn without calling any tool. Only run step 5 on the next turn, after the user replies with a go-ahead (e.g., "yes", "confirm", "go").

       Market: <main|xyz>
       Side: <long|short>
       Size: <size> <coin> (~$<notional> notional)
       Leverage: <leverage>x
       Margin Mode: <cross|isolated>
       Est. liquidation: ~$<price> (rough, excludes mmr)

   Read `Leverage` from the value you set in step 2. Read `Margin Mode` from the `marginType` column; don't guess. Estimate liquidation from the step 1 price and the leverage: long ≈ `price × (1 − 1/leverage)`, short ≈ `price × (1 + 1/leverage)`. This is a rough figure that excludes maintenance margin — the precise `liquidationPx` shows up in `position list` after opening (report it in step 6). If the user wants to change a field, loop back to the relevant step and re-emit the summary before waiting again.

5. **Open the position:**

   ```bash
   byreal-perps-cli order market <long|short> <size> <coin>
   ```

6. **Report the result** from the CLI's returned confirmation.

#### Worked gate example — copy this shape exactly

The two turns below are the expected pattern for any opening order. The turn boundary is the most important part: turn 1 ends *with the summary*, no `order market` call. The `order market` tool call only happens on turn 2, after the user replies "go" / "confirm" / "yes".

```
===== User message =====
帮我开一个 $15 的 ETH 多单

===== Turn 1 (assistant) =====
[tool] signal detail ETH -o json         → data.price = 2327.80
[tool] position leverage ETH 3
[compute] size = 15 / 2327.80 ≈ 0.00644 ETH

Reply to user (summary only, no order placed):

    Market: main
    Side: long
    Size: 0.00644 ETH (~$15 notional)
    Leverage: 3x
    Margin Mode: cross
    Est. liquidation: ~$1552 (rough, excludes mmr)

    Reply "go" / "confirm" to place the order, or tell me what to change.

[end turn — DO NOT call order market in this turn]

===== User message =====
go

===== Turn 2 (assistant) =====
[tool] order market long 0.00644 ETH

Reply to user: [CLI confirmation + liquidationPx from position list]
```

Failure mode to avoid (observed in production): calling `signal detail` → `order market` in the same turn, then apologizing to the user afterwards. The summary-and-stop pattern above is what actually prevents that — the `order market` call MUST be on a different turn from the summary, gated by the user's reply.

### Open a new position with TP/SL

```bash
# 1. Get the live coin price
byreal-perps-cli signal detail <coin> -o json

# 2. Set leverage first if the user specified one
byreal-perps-cli position leverage <coin> <leverage>

# 3. Open the position with attached TP/SL
byreal-perps-cli order market <long|short> <size> <coin> --tp <tp_price> --sl <sl_price>
```

Execution rule:

1. For a new position with stop-loss / take-profit, attach --tp and --sl to the opening order.
2. Do not translate stop-loss intent into a standalone sell order.
3. Use position tpsl only when the position already exists.
4. Same as "Open a new position". In step 4's summary, add a `TP: <price> / SL: <price>` line (only the side the user asked for). In step 5, attach `--tp` / `--sl` to the order, matching the summary exactly.

### Close an existing position

When the user says "close my BTC position" or "close my SOL short", do not jump straight to a close command. Check the live position first so you know whether the coin is open, what side it is, and how large it is.

```bash
# 1. Check the existing position
byreal-perps-cli position list --coin <coin> -o json

# 2a. If a position exists and the user just wants to close it now
byreal-perps-cli position close-market <coin>

# 2b. If the user wants to close only part of it
byreal-perps-cli position close-market <coin> --size <partial_size>

# 2c. If the user gives a target exit price
byreal-perps-cli position close-limit <coin> <price>
```

Execution rule:

1. Read `position list` first.
2. If no position exists for that coin, stop and report that there is no open position.
3. If the user says "close my <coin> position" with no price, use `position close-market <coin>`.
4. If the user provides an exit price, use `position close-limit <coin> <price>`.
5. If the user says "close half" or gives a partial amount, use `--size <n>`.

### Add or update TP/SL on an existing position

```bash
# 1. Confirm the position exists
byreal-perps-cli position list --coin <coin> -o json

# 2. Check existing TP/SL
byreal-perps-cli position tpsl <coin>

# 3. Apply the new TP/SL
byreal-perps-cli position tpsl <coin> --tp <tp_price> --sl <sl_price>
```

Execution rule:

1. Confirm the position exists first.
2. Use `position tpsl <coin>` for an existing position, not a new sell/buy order.
3. If `TPSL_ERROR` occurs, immediately re-check with `position tpsl <coin>`.

### Check account state before trading

```bash
# Show account balances and margin
byreal-perps-cli account info

# Show current open positions
byreal-perps-cli position list

# Show current open orders
byreal-perps-cli order list
```

Execution rule:

1. Use `account info` when the user asks about balance, available margin, or account value.
2. Use `position list` when the user asks what positions are open.
3. Use `order list` when the user asks about resting orders.

### Review recent trade activity

```bash
# Show the latest fills
byreal-perps-cli account history

# Show more fills
byreal-perps-cli account history --limit 50
```

Execution rule:

1. Use `account history` for recent fills and executed trades.
2. Increase `--limit` only when the user wants a longer trade history window.

### Close all positions

```bash
# 1. Check open positions first
byreal-perps-cli position list

# 2. Close everything
byreal-perps-cli position close-all -y
```

Execution rule:

1. Review `position list` first so the user knows what will be closed.
2. Use `close-all` only when the user explicitly wants every open position closed.
3. After `close-all`, verify with `position list`. If any position remains, do not assume the account is flat — re-check and, if needed, run another close command for the remaining coin(s).

## Installation

```bash
# Check if already installed
which byreal-perps-cli && byreal-perps-cli --version

# Install
npm install -g @byreal-io/byreal-perps-cli
```

## Credentials

- Trading commands require account initialization via `byreal-perps-cli account init`
- `--method token` (default): reads `~/.openclaw/realclaw-config.json`, no private key needed
- `--method generate`: requires an EVM private key — materially more sensitive than the token method. If token method fails, inform the user that automatic setup failed and manual intervention is needed. Do not offer to run `--method generate`.
- Signal commands (`signal scan`, `signal detail`): no account required

## Account Recovery

If local perps account state appears broken or expired:

1. Try `byreal-perps-cli account init` again first.
2. If the error mentions missing or invalid OpenClaw config, inspect `~/.openclaw/realclaw-config.json`.
3. If account selection or local state still looks corrupted, inspect the local DB at `~/.byreal-perps/perps.db`.
4. Only if the user explicitly wants a local reset, remove or replace the local DB and then re-run `account init`.

Do not delete `~/.byreal-perps/perps.db` silently. Treat it as destructive local recovery.

## Notes

1. **`-o json` only for parsing** — when showing results to the user, omit it and let the CLI's built-in tables render. Don't fetch JSON then re-draw tables yourself.
2. **Never display private keys** — use keypair paths only.
3. **Never call the SDK directly** — don't write `node -e` / `tsx -e` scripts that import `@nktkas/hyperliquid` or `viem`. The SDK is bundled inside the CLI; calling it externally causes CJS/ESM compatibility errors and bypasses the CLI's account selection, locally stored agent key handling, and transport/config setup.

## Error Codes

Most JSON success responses use this shape:

```json
{
  "success": true,
  "meta": { "timestamp": "...", "version": "..." },
  "data": { "...": "..." }
}
```

Read command-specific fields from `data.*`, for example `data.price` from `signal detail`.

JSON caveat: some commands still have noisy edge cases. In particular, `account init` and `position close-all` failure/no-op paths may print extra text instead of a perfectly clean JSON-only payload. For machine parsing, prefer read-only commands like `signal detail`, `signal scan`, `order list`, `position list`, and `account info`. For those noisy commands, treat JSON as best-effort and verify the resulting state with a follow-up read command.

Common CLI error codes in JSON mode:

- `ACCOUNT_INIT_ERROR` — account setup failed
- `ACCOUNT_ERROR` — account info/history fetch failed
- `ORDER_ERROR` — market/limit order placement failed
- `ORDER_LIST_ERROR` — open-order listing failed
- `CANCEL_ERROR` — order cancellation failed
- `POSITION_ERROR` — position listing failed
- `LEVERAGE_ERROR` — leverage update failed
- `MARGIN_MODE_ERROR` — margin mode switch failed
- `TPSL_ERROR` — TP/SL view/set/cancel failed
- `CLOSE_ERROR` — position close command failed
- `SIGNAL_ERROR` — signal scan/detail failed
- `CLI_ERROR` — top-level CLI failure before command-specific handling
- `UNKNOWN_ERROR` — fallback code when the command does not provide a specific error code

TP/SL recovery flow:

1. If a TP/SL update returns `TPSL_ERROR`, do not assume protection is still active.
2. Check the live state: `byreal-perps-cli position tpsl <coin>`
3. If TP or SL is missing, submit the needed `position tpsl` command again.

## Commands Reference

### Account Management

```bash
# Initialize perps account (default: token method, no private key needed)
byreal-perps-cli account init

# Initialize via generate method (requires EVM wallet private key)
byreal-perps-cli account init --method generate

# Show account info & balance
byreal-perps-cli account info

# Show recent trade history
byreal-perps-cli account history
```

### Orders

```bash
# Market order (side: buy/sell/long/short, size in coin units)
byreal-perps-cli order market <side> <size> <coin>

# Market buy with bracket TP/SL
byreal-perps-cli order market buy 0.01 BTC --tp 110000 --sl 90000

# Market order with stop-loss only
byreal-perps-cli order market long 1 ETH --sl 3500

# Plain market order
byreal-perps-cli order market short 0.5 SOL

# HIP-3 / xyz market example
byreal-perps-cli order market long 5 xyz:GOLD

# Limit order
byreal-perps-cli order limit <side> <size> <coin> <price>
byreal-perps-cli order limit sell 1 ETH 4000
byreal-perps-cli order limit buy 0.01 BTC 95000 --tp 110000 --sl 90000

# List open orders
byreal-perps-cli order list

# Cancel an order
byreal-perps-cli order cancel <oid>

# Cancel all orders
byreal-perps-cli order cancel-all -y
```

### Positions

```bash
# List open positions
byreal-perps-cli position list

# Set leverage (1-50x)
byreal-perps-cli position leverage <coin> <leverage>

# Switch margin mode (cross / isolated)
byreal-perps-cli position margin-mode <coin> <mode>

# Set TP/SL on existing position
byreal-perps-cli position tpsl <coin> --tp <price> --sl <price>

# Set only stop-loss on existing position
byreal-perps-cli position tpsl BTC --sl 90000

# HIP-3 / xyz TP/SL example
byreal-perps-cli position tpsl xyz:GOLD --tp 3100 --sl 2700

# View existing TP/SL orders for a position
byreal-perps-cli position tpsl <coin>

# Cancel existing TP/SL orders
byreal-perps-cli position tpsl <coin> --cancel-tp
byreal-perps-cli position tpsl <coin> --cancel-sl

# Close at market price (full or partial)
byreal-perps-cli position close-market <coin>

# Close with limit order
byreal-perps-cli position close-limit <coin> <price>

# Close all positions
byreal-perps-cli position close-all -y
```

### Market Signals

```bash
# Scan markets for trading signals
byreal-perps-cli signal scan

# Detailed technical analysis
byreal-perps-cli signal detail <coin>
```

Rate-limit guidance:

- `signal scan` already batches internally; prefer it over looping `signal detail` across many coins.
- Do not fan out dozens of `signal detail` calls at once. Run them sequentially or in small batches.
- If repeated signal calls start failing with `SIGNAL_ERROR`, slow down and retry after a short pause instead of hammering the public API.

### Update

```bash
# Check for available CLI updates
byreal-perps-cli update check

# Install the latest CLI version
byreal-perps-cli update install
```
