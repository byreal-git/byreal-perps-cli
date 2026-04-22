/**
 * Catalog command - capability discovery
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import { TABLE_CHARS, VERSION } from '../../core/constants.js';

// ============================================
// Capability Registry
// ============================================

interface Capability {
  id: string;
  name: string;
  description: string;
  category: 'query' | 'analyze' | 'execute';
  auth_required: boolean;
  command: string;
  params: CapabilityParam[];
}

interface CapabilityParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  enum?: string[];
}

const CAPABILITIES: Capability[] = [
  // ============================================
  // Account
  // ============================================
  {
    id: 'account.init',
    name: 'Account Init',
    description: 'Interactive wizard to set up Hyperliquid perps trading account',
    category: 'execute',
    auth_required: false,
    command: 'byreal-perps-cli account init',
    params: [
      { name: 'default', type: 'boolean', required: false, description: 'Set as default account', default: 'true' },
    ],
  },
  {
    id: 'account.info',
    name: 'Account Info',
    description: 'Show perps account info and balance (address, spot USDC, account value, margin, PnL, withdrawable, available margin)',
    category: 'query',
    auth_required: true,
    command: 'byreal-perps-cli account info',
    params: [],
  },
  {
    id: 'account.history',
    name: 'Trade History',
    description: 'Show recent trade fills (coin, side, size, price, fee)',
    category: 'query',
    auth_required: true,
    command: 'byreal-perps-cli account history',
    params: [
      { name: 'limit', type: 'integer', required: false, description: 'Number of fills to show', default: '20' },
    ],
  },
  // ============================================
  // Order
  // ============================================
  {
    id: 'order.market',
    name: 'Market Order',
    description: 'Place a market order on Hyperliquid perps. Supports TP/SL bracket orders.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli order market <side> <size> <coin>',
    params: [
      { name: 'side', type: 'string', required: true, description: 'Order side: buy, sell, long, short' },
      { name: 'size', type: 'string', required: true, description: 'Order size' },
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'slippage', type: 'string', required: false, description: 'Slippage percentage (overrides config)' },
      { name: 'reduce-only', type: 'boolean', required: false, description: 'Reduce-only order' },
      { name: 'tp', type: 'string', required: false, description: 'Take profit price' },
      { name: 'sl', type: 'string', required: false, description: 'Stop loss price' },
    ],
  },
  {
    id: 'order.limit',
    name: 'Limit Order',
    description: 'Place a limit order on Hyperliquid perps. Supports TP/SL bracket orders.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli order limit <side> <size> <coin> <price>',
    params: [
      { name: 'side', type: 'string', required: true, description: 'Order side: buy, sell, long, short' },
      { name: 'size', type: 'string', required: true, description: 'Order size' },
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'price', type: 'string', required: true, description: 'Limit price' },
      { name: 'tif', type: 'string', required: false, description: 'Time-in-force', default: 'Gtc', enum: ['Gtc', 'Ioc', 'Alo'] },
      { name: 'reduce-only', type: 'boolean', required: false, description: 'Reduce-only order' },
      { name: 'tp', type: 'string', required: false, description: 'Take profit price' },
      { name: 'sl', type: 'string', required: false, description: 'Stop loss price' },
    ],
  },
  {
    id: 'order.list',
    name: 'Open Orders',
    description: 'List all open perps orders',
    category: 'query',
    auth_required: true,
    command: 'byreal-perps-cli order list',
    params: [],
  },
  {
    id: 'order.cancel',
    name: 'Cancel Order',
    description: 'Cancel a perps order by order ID',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli order cancel <oid>',
    params: [
      { name: 'oid', type: 'integer', required: true, description: 'Order ID to cancel' },
    ],
  },
  {
    id: 'order.cancel-all',
    name: 'Cancel All Orders',
    description: 'Cancel all open perps orders. Requires confirmation. In non-TTY environments, outputs a warning and exits — re-run with -y to confirm.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli order cancel-all',
    params: [
      { name: 'yes', type: 'boolean', required: false, description: 'Skip confirmation prompt' },
    ],
  },
  // ============================================
  // Position
  // ============================================
  {
    id: 'position.list',
    name: 'Positions',
    description: 'List all open perps positions (includes main and HIP-3 DEX positions)',
    category: 'query',
    auth_required: true,
    command: 'byreal-perps-cli position list',
    params: [
      { name: 'coin', type: 'string', required: false, description: 'Filter by coin symbol' },
    ],
  },
  {
    id: 'position.leverage',
    name: 'Set Leverage',
    description: 'Set leverage for a coin on Hyperliquid perps',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position leverage <coin> <leverage>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'leverage', type: 'integer', required: true, description: 'Leverage value (1-50)' },
      { name: 'cross', type: 'boolean', required: false, description: 'Use cross margin (default)' },
      { name: 'isolated', type: 'boolean', required: false, description: 'Use isolated margin' },
    ],
  },
  {
    id: 'position.margin',
    name: 'Adjust Margin',
    description: 'Add or remove margin for an isolated position. Only works when the position is in isolated margin mode. Validates available balance (add) or max removable margin (remove) before execution.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position margin <coin> <action> <amount>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'action', type: 'string', required: true, description: 'Action: add or remove' },
      { name: 'amount', type: 'string', required: true, description: 'Amount in USDC' },
    ],
  },
  {
    id: 'position.margin-mode',
    name: 'Switch Margin Mode',
    description: 'Switch margin mode between cross and isolated for a coin. Validates whether the asset supports the target mode before switching.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position margin-mode <coin> <mode>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'mode', type: 'string', required: true, description: 'Margin mode: cross or isolated' },
    ],
  },
  {
    id: 'position.tpsl',
    name: 'Position TP/SL',
    description: 'Set, view, or cancel take-profit and stop-loss trigger orders on an existing position. Uses positionTpsl grouping so orders scale with position size.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position tpsl <coin>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'tp', type: 'string', required: false, description: 'Take profit trigger price' },
      { name: 'sl', type: 'string', required: false, description: 'Stop loss trigger price' },
      { name: 'cancel-tp', type: 'boolean', required: false, description: 'Cancel existing take profit order' },
      { name: 'cancel-sl', type: 'boolean', required: false, description: 'Cancel existing stop loss order' },
    ],
  },
  {
    id: 'position.close-market',
    name: 'Close Position (Market)',
    description: 'Close a perps position at market price (full or partial)',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position close-market <coin>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'size', type: 'string', required: false, description: 'Partial close size (default: full close)' },
      { name: 'slippage', type: 'string', required: false, description: 'Slippage percentage (overrides config)' },
    ],
  },
  {
    id: 'position.close-limit',
    name: 'Close Position (Limit)',
    description: 'Close a perps position with a limit order. Prompts for confirmation if the limit price would fill immediately with >5% slippage. In non-TTY environments, outputs a warning and exits — re-run with -y to confirm.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position close-limit <coin> <price>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH, xyz:gold)' },
      { name: 'price', type: 'string', required: true, description: 'Limit price' },
      { name: 'size', type: 'string', required: false, description: 'Partial close size (default: full close)' },
      { name: 'tif', type: 'string', required: false, description: 'Time-in-force', default: 'Gtc', enum: ['Gtc', 'Ioc', 'Alo'] },
      { name: 'yes', type: 'boolean', required: false, description: 'Skip slippage confirmation prompt' },
    ],
  },
  {
    id: 'position.close-all',
    name: 'Close All Positions',
    description: 'Close all open perps positions at market price. Requires confirmation. In non-TTY environments, outputs a warning and exits — re-run with -y to confirm.',
    category: 'execute',
    auth_required: true,
    command: 'byreal-perps-cli position close-all',
    params: [
      { name: 'slippage', type: 'string', required: false, description: 'Slippage percentage (overrides config)' },
      { name: 'yes', type: 'boolean', required: false, description: 'Skip confirmation prompt' },
    ],
  },
  // ============================================
  // Signal
  // ============================================
  {
    id: 'signal.scan',
    name: 'Signal Scan',
    description: 'Scan markets for trading signals grouped by risk category (conservative / moderate / aggressive). Uses RSI, funding, volume, and momentum scoring.',
    category: 'analyze',
    auth_required: false,
    command: 'byreal-perps-cli signal scan',
    params: [
      { name: 'top', type: 'integer', required: false, description: 'Max signals per category', default: '5' },
      { name: 'min-volume', type: 'string', required: false, description: 'Min 24h volume in USD', default: '1000000' },
    ],
  },
  {
    id: 'signal.detail',
    name: 'Signal Detail',
    description: 'Detailed signal analysis for a specific coin: RSI (4h/1h), MACD, Bollinger Bands, EMA crossover, trend alignment, and trading suggestion',
    category: 'analyze',
    auth_required: false,
    command: 'byreal-perps-cli signal detail <coin>',
    params: [
      { name: 'coin', type: 'string', required: true, description: 'Coin symbol (e.g., BTC, ETH)' },
    ],
  },
  // ============================================
  // Update
  // ============================================
  {
    id: 'update.check',
    name: 'Check Update',
    description: 'Check for available CLI updates from npm registry',
    category: 'query',
    auth_required: false,
    command: 'byreal-perps-cli update check',
    params: [],
  },
  {
    id: 'update.install',
    name: 'Install Update',
    description: 'Install the latest CLI version from npm registry',
    category: 'execute',
    auth_required: false,
    command: 'byreal-perps-cli update install',
    params: [],
  },
];

// ============================================
// Search Capabilities
// ============================================

function searchCapabilities(keyword: string): Capability[] {
  const lowerKeyword = keyword.toLowerCase();
  return CAPABILITIES.filter(
    (cap) =>
      cap.id.toLowerCase().includes(lowerKeyword) ||
      cap.name.toLowerCase().includes(lowerKeyword) ||
      cap.description.toLowerCase().includes(lowerKeyword)
  );
}

function outputCapabilitiesTable(capabilities: Capability[]): void {
  const table = new Table({
    head: [chalk.cyan.bold('ID'), chalk.cyan.bold('Name'), chalk.cyan.bold('Category'), chalk.cyan.bold('Auth')],
    chars: TABLE_CHARS,
  });

  for (const cap of capabilities) {
    table.push([
      chalk.white(cap.id),
      cap.name,
      cap.category,
      cap.auth_required ? chalk.yellow('Yes') : chalk.green('No'),
    ]);
  }

  console.log(table.toString());
}

function outputCapabilityDetail(cap: Capability): void {
  console.log(chalk.cyan.bold(`\n${cap.name}`));
  console.log(chalk.gray(`ID: ${cap.id}\n`));
  console.log(`${cap.description}\n`);
  console.log(chalk.white(`Category: ${cap.category}`));
  console.log(chalk.white(`Auth Required: ${cap.auth_required ? 'Yes' : 'No'}`));
  console.log(chalk.white(`\nCommand: ${chalk.green(cap.command)}`));

  if (cap.params.length > 0) {
    console.log(chalk.cyan('\nParameters:'));
    const table = new Table({
      head: [chalk.cyan('Name'), chalk.cyan('Type'), chalk.cyan('Required'), chalk.cyan('Default'), chalk.cyan('Description')],
      chars: TABLE_CHARS,
    });

    for (const param of cap.params) {
      table.push([
        chalk.white(`--${param.name}`),
        param.type,
        param.required ? chalk.yellow('Yes') : 'No',
        param.default || '-',
        param.description,
      ]);
    }

    console.log(table.toString());

    for (const param of cap.params) {
      if (param.enum) {
        console.log(chalk.gray(`  --${param.name} values: ${param.enum.join(', ')}`));
      }
    }
  }

  console.log(chalk.cyan('\nExample:'));
  console.log(chalk.green(`  ${cap.command} -o json`));
}

// ============================================
// Register Catalog Command
// ============================================

export function registerCatalogCommand(perps: Command): void {
  const catalog = perps
    .command('catalog')
    .description('Discover available capabilities');

  catalog
    .command('search <keyword>')
    .description('Search capabilities by keyword')
    .action((keyword: string, _options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const results = searchCapabilities(keyword);

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: { capabilities: results, total: results.length },
        }, null, 2));
      } else {
        if (results.length === 0) {
          console.log(chalk.yellow(`No capabilities found for "${keyword}"`));
        } else {
          console.log(chalk.cyan(`\nFound ${results.length} capabilities:\n`));
          outputCapabilitiesTable(results);
        }
      }
    });

  catalog
    .command('show <capability-id>')
    .description('Show detailed information about a capability')
    .action((capabilityId: string, _options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();
      const cap = CAPABILITIES.find((c) => c.id === capabilityId);

      if (!cap) {
        if (globalOptions.output === 'json') {
          console.log(JSON.stringify({
            success: false,
            error: {
              code: 'CAPABILITY_NOT_FOUND',
              type: 'BUSINESS',
              message: `Capability not found: ${capabilityId}`,
              suggestions: [
                { action: 'search', description: 'Search capabilities', command: 'byreal-perps-cli catalog search <keyword>' },
              ],
            },
          }, null, 2));
        } else {
          console.log(chalk.red(`Capability not found: ${capabilityId}`));
          console.log(chalk.gray('Use "byreal-perps-cli catalog search <keyword>" to find capabilities'));
        }
        process.exit(1);
      }

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: cap,
        }, null, 2));
      } else {
        outputCapabilityDetail(cap);
      }
    });

  catalog
    .command('list', { isDefault: true })
    .description('List all capabilities')
    .action((_options: unknown, cmd: Command) => {
      const globalOptions = cmd.optsWithGlobals();

      if (globalOptions.output === 'json') {
        console.log(JSON.stringify({
          success: true,
          meta: { timestamp: new Date().toISOString(), version: VERSION },
          data: { capabilities: CAPABILITIES, total: CAPABILITIES.length },
        }, null, 2));
      } else {
        console.log(chalk.cyan(`\nAvailable Capabilities (${CAPABILITIES.length}):\n`));
        outputCapabilitiesTable(CAPABILITIES);
      }
    });
}
