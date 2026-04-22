# Byreal Perps CLI

AI-native CLI for [Byreal Hyperliquid perpetual  futures trading](https://byreal.io/en/perps). Designed for LLM agents: every command supports structured JSON output, and the built-in skill system lets AI assistants discover and use all capabilities automatically.

## AI Integration

Install it as a **Skill** so your LLM can discover all capabilities:

```bash
npx skills add byreal-git/byreal-perps-cli
```

Or install the CLI only:

```bash
npm install -g @byreal-io/byreal-perps-cli
```

## Features

- **Account** — Initialize perps account, view balance, trade history.
- **Orders** — Market and limit orders with TP/SL, list open orders, cancel orders.
- **Positions** — List positions, set/manage TP/SL on existing positions, close at market/limit, close all, set leverage, adjust isolated margin.
- **Signals** — Scan markets for trading signals, detailed technical analysis per coin.
- **Catalog** — Discover all CLI capabilities programmatically.

## Quick Start

```bash
# Initialize perps account (no private key needed)
byreal-perps-cli account init

# Check account info
byreal-perps-cli account info

# Set leverage
byreal-perps-cli position leverage BTC 10

# Market order: long 0.01 BTC with TP/SL
byreal-perps-cli order market buy 0.01 BTC --tp 110000 --sl 90000

# Limit order: short 1 ETH at $4000
byreal-perps-cli order limit sell 1 ETH 4000

# List open positions and orders
byreal-perps-cli position list
byreal-perps-cli order list

# Set TP/SL on an existing position
byreal-perps-cli position tpsl BTC --tp 110000 --sl 90000

# View existing TP/SL for a position
byreal-perps-cli position tpsl BTC

# Close a position at market price
byreal-perps-cli position close-market BTC

# Close a position with limit order
byreal-perps-cli position close-limit BTC 100000

# Add margin to an isolated position
byreal-perps-cli position margin BTC add 100

# Remove margin from an isolated position
byreal-perps-cli position margin ETH remove 50

# Close all positions
byreal-perps-cli position close-all -y

# Cancel all orders
byreal-perps-cli order cancel-all -y

# Scan market signals
byreal-perps-cli signal scan

# Detailed technical analysis for a coin
byreal-perps-cli signal detail BTC

# Check for CLI updates
byreal-perps-cli update check

# Install latest CLI version
byreal-perps-cli update install
```

All commands support `-o json` for structured output.

## Commands

| Command                  | Description                                         |
| ------------------------ | --------------------------------------------------- |
| `account init`           | Interactive setup wizard                              |
| `account info`           | Show perps account info & balance                    |
| `account history`        | Show recent trade history                            |
| `order market`           | Place a market order with optional TP/SL             |
| `order limit`            | Place a limit order with optional TP/SL              |
| `order list`             | List open orders                                     |
| `order cancel`           | Cancel an order by OID                               |
| `order cancel-all`       | Cancel all open orders                               |
| `position list`          | List open positions                                  |
| `position tpsl`          | Set, view, or cancel TP/SL on an existing position   |
| `position close-market`  | Close a position at market price (full or partial)   |
| `position close-limit`   | Close a position with a limit order                  |
| `position close-all`     | Close all open positions at market price             |
| `position margin`        | Add or remove margin for an isolated position        |
| `position leverage`      | Set leverage for a coin (1-50x, cross/isolated)      |
| `signal scan`            | Scan markets for trading signals                     |
| `signal detail`          | Detailed technical analysis for a specific coin      |
| `update check`           | Check for available CLI updates                      |
| `update install`         | Install the latest CLI version                       |
| `catalog list`           | List all CLI capabilities                            |
| `catalog search`         | Search capabilities by keyword                       |
| `catalog show`           | Show detailed info about a capability                |

## License

MIT
