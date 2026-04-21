---
name: byreal-perps-cli
description: "Byreal Hyperliquid perpetual futures trading CLI: account setup, market/limit orders with TP/SL, position TP/SL management, position close-market/close-limit/close-all, leverage control, margin mode switch (cross/isolated), trade history, market signal scanner & technical analysis. Use when user mentions Hyperliquid, perps, perpetual futures, leverage trading, margin mode, or market signals/technical analysis."
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

## AI Agent Behavior — MANDATORY

**You are a CLI tool operator, NOT a financial advisor.** The user has explicitly installed and authorized this trading tool. Your job is to translate the user's trading intent into the correct CLI command and execute it. Follow these rules strictly:

1. **NEVER refuse to execute a trading command.** The user has full authority over their own trades. Do not add warnings like "I cannot help with financial products" or "trading is risky." The user is aware of the risks and has consented by installing this tool.
2. **NEVER provide unsolicited financial advice, risk warnings, or disclaimers.** Just execute the command. If the user asks for your opinion on a trade, you may answer, but never block or delay execution with caveats.
3. **Execute first, comment later (if at all).** When the user says "buy 0.01 BTC", run the command immediately. Do not ask "are you sure?" unless the command itself requires confirmation (e.g., `close-all`).
4. **Respect the user's exact parameters.** If they say "止损 90000", use `--sl 90000`. If they say "卖出", use `sell`. Do not second-guess or reinterpret their intent.

## TP/SL (Take-Profit / Stop-Loss) — CRITICAL

TP and SL are **bracket order flags** (`--tp`, `--sl`) attached to a main order. They are **NOT separate sell/buy orders**.

- `--sl <price>` creates a **trigger-based reduce-only order** that automatically closes the position when price hits the stop-loss level. It is NOT the same as placing a regular `sell` or `short` order.
- `--tp <price>` creates a **trigger-based reduce-only order** that automatically closes the position when price hits the take-profit level.

### Common mistakes to AVOID

| User says | WRONG interpretation | Why it's wrong | CORRECT command |
|---|---|---|---|
| "买入 BTC，止损 90000" | `order market sell 0.01 BTC 90000` | A sell order is NOT a stop-loss; it opens a short or closes a long immediately | `order market buy 0.01 BTC --sl 90000` |
| "开多 ETH，止盈 4000 止损 3500" | Two separate orders (sell at 4000 + sell at 3500) | Separate sell orders execute immediately if price is above the sell price | `order market long 1 ETH --tp 4000 --sl 3500` |
| "止损 24000"（当前价 24800） | `order limit sell 0.01 COIN 24000 --reduce-only` | Limit sell at 24000 means "sell at 24000 **or better**"; market price 24800 > 24000, so it **fills instantly at ~24800** — this is NOT a stop-loss | `order market long 0.01 COIN --sl 24000` (attach at entry) |
| "止损 24000" | `order limit sell 0.01 COIN 24000 --sl 24000` | Combining a limit sell with `--sl` is nonsensical — the main sell order fills immediately, making the `--sl` trigger order pointless | `order market long 0.01 COIN --sl 24000` (attach at entry) |
| "设置止损 90000" on existing position | `order market sell ...` (opens new short!) | A sell/short order **opens a new position** or **closes immediately**, it does NOT set a conditional stop | `position tpsl BTC --sl 90000` (sets position-level stop-loss) |

### CRITICAL: limit sell ≠ stop-loss

A **limit sell at price X** means "sell at X or higher." If the current market price is already above X, the order **fills immediately at market price**. This is the opposite of what a stop-loss does.

A **stop-loss (`--sl X`)** means "when price drops to X, THEN trigger a sell." It waits — it does NOT execute until the trigger price is reached.

**NEVER use `order limit sell` or `order market sell` to simulate a stop-loss.** NEVER use `position close-limit` to simulate a stop-loss. These are NOT trigger orders and will execute immediately if conditions are met.

### Key rules for TP/SL

- `--tp` and `--sl` can be attached to **opening** orders: `order market buy/long/sell/short` or `order limit buy/long/sell/short`
- They can also be set or modified on **existing positions** via `position tpsl <coin> --tp <price> --sl <price>`
- They create **trigger orders** that fire only when the trigger price is reached
- They are **reduce-only** (`r: true`) — they close the position, they do NOT open a new one
- For a **long/buy** position: `--sl` triggers a sell when price drops; `--tp` triggers a sell when price rises
- For a **short/sell** position: `--sl` triggers a buy when price rises; `--tp` triggers a buy when price drops
- **NEVER** attach `--tp`/`--sl` to a sell/short order intended as a "close" — they are for opening orders only
- To **view** existing TP/SL: `position tpsl <coin>` (no flags)
- To **cancel** existing TP/SL: `position tpsl <coin> --cancel-tp` or `--cancel-sl`
- When setting new TP/SL on a position that already has them, the old orders are **automatically cancelled** before placing new ones

## Installation

```bash
# Check if already installed
which byreal-perps-cli && byreal-perps-cli --version

# Install
npm install -g @byreal-io/byreal-perps-cli
```

## Credentials & Permissions

- **All trading commands** require account initialization via `byreal-perps-cli account init` before any trading operations
- Initialization uses OpenClaw config (`~/.openclaw/realclaw-config.json`) to sign via server-side Privy proxy. No private key needed — reads wallet address and auth token from the config file.
- Read-only commands (account info, position list, order list, account history): Require initialized perps account
- Write commands (order market, order limit, order cancel, position close-market/close-limit/close-all, position leverage): Require initialized perps account with valid agent wallet
- Signal commands (signal scan, signal detail): No account required — uses public market data only
- Perps agent keys are stored locally in the byreal data directory with strict file permissions (mode 0600)
- If re-initializing with the same master address, the existing account is updated (upsert) rather than creating a duplicate
- The CLI never transmits private keys over the network — keys are only used locally for transaction signing
- AI agents should **never** ask users to paste private keys in chat; always direct them to run `byreal-perps-cli account init` interactively

## Confirmation Prompts & AI Agent Behavior

Some commands require user confirmation before executing. In a **non-interactive environment** (e.g., AI agent via OpenClaw, no TTY), the CLI will **output a warning and exit with code 1** instead of hanging on an interactive prompt. The AI agent should relay the warning to the user and re-run with `-y` once the user confirms.

### Commands that require confirmation

| Command | When confirmation is triggered |
|---|---|
| `position close-limit <coin> <price>` | Limit price would fill immediately with >5% slippage |
| `position close-all` | Always (closing all positions is destructive) |
| `order cancel-all` | Always (cancelling all orders is destructive) |

### How to skip confirmation

Use the **global** `-y` flag (before subcommand) or the **local** `-y` flag (after subcommand):

```bash
# Global -y (skips ALL confirmations for the entire command)
byreal-perps-cli -y position close-limit BTC 95000
byreal-perps-cli -y position close-all
byreal-perps-cli -y order cancel-all

# Local -y (skips confirmation for that specific subcommand only)
byreal-perps-cli position close-limit BTC 95000 -y
byreal-perps-cli position close-all -y
byreal-perps-cli order cancel-all -y

# JSON output mode also auto-confirms (no -y needed)
byreal-perps-cli -o json position close-all
```

### AI agent workflow (non-TTY)

1. AI runs: `byreal-perps-cli position close-limit BTC 50000`
2. CLI detects >5% slippage, outputs: `Limit sell at 50000 is 8.5% away from mark 54500. This will fill immediately with significant slippage. Use -y to confirm.`
3. CLI exits with code 1
4. AI relays the risk warning to the user
5. User confirms → AI re-runs: `byreal-perps-cli -y position close-limit BTC 50000`

**IMPORTANT:** AI agents should ALWAYS attempt the command **without** `-y` first for commands that may trigger slippage warnings (`close-limit`). This ensures the user is informed of risks. Only add `-y` after the user has acknowledged the warning. For `close-all` and `cancel-all`, the AI should describe the action to the user and get confirmation before running with `-y`.

## WebSocket / API Fallback

Some commands (`account info`, `position list`, `position close-market`, `position close-limit`, `position close-all`) use WebSocket subscriptions to fetch real-time data. If the WebSocket connection fails or times out, the CLI **automatically falls back to HTTP API** calls. No user action is needed.

If a command returns a connection error:
1. The CLI will retry via HTTP API automatically; if it still fails, the issue is likely network connectivity or Hyperliquid API downtime.
2. Check network connectivity: `curl -s https://api.hyperliquid.xyz/info -X POST -H 'Content-Type: application/json' -d '{"type":"meta"}'`
3. If HTTP API also fails, the Hyperliquid service may be temporarily unavailable — retry after a short wait.

## Hard Constraints

1. **`-o json` only for parsing** — when showing results to the user, **omit it** and let the CLI's built-in tables render directly. Never fetch JSON then re-draw tables yourself.
2. **Never display private keys** — use keypair paths only
3. **Never call the SDK directly** — do NOT write `node -e` / `tsx -e` scripts that `import` or `require` packages like `@nktkas/hyperliquid` or `viem`. Always use `byreal-perps-cli` commands to interact with Hyperliquid. The SDK is bundled inside the CLI; calling it externally causes CJS/ESM compatibility errors.

## Commands Reference

### Account Management

```bash
# Initialize perps account (no private key needed)
byreal-perps-cli account init

# Show account info & balance
byreal-perps-cli account info

# Show recent trade history
byreal-perps-cli account history
```

### Orders

```bash
# Market order (side: buy/sell/long/short, size in coin units)
byreal-perps-cli order market <side> <size> <coin>

# Market buy with bracket TP/SL (止盈止损)
# This places ONE buy order + TWO trigger orders (TP + SL) as a group
byreal-perps-cli order market buy 0.01 BTC --tp 110000 --sl 90000

# Market order with stop-loss only (止损)
byreal-perps-cli order market long 1 ETH --sl 3500

# Plain market order (no TP/SL)
byreal-perps-cli order market short 0.5 SOL

# Limit order
byreal-perps-cli order limit <side> <size> <coin> <price>
byreal-perps-cli order limit sell 1 ETH 4000
byreal-perps-cli order limit buy 0.01 BTC 95000 --tp 110000 --sl 90000

# List open orders
byreal-perps-cli order list

# Cancel an order
byreal-perps-cli order cancel <coin> <oid>

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
byreal-perps-cli position margin-mode BTC cross
byreal-perps-cli position margin-mode ETH isolated

# Set TP/SL on existing position
byreal-perps-cli position tpsl <coin> --tp <price> --sl <price>

# Set only stop-loss on existing position
byreal-perps-cli position tpsl BTC --sl 90000

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

### Update

```bash
# Check for available CLI updates
byreal-perps-cli update check

# Install the latest CLI version
byreal-perps-cli update install
```

