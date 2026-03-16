import type { Command } from 'commander';
import { registerMarketCommand } from './market.js';
import { registerLimitCommand } from './limit.js';
import { registerCancelCommand } from './cancel.js';
import { registerCancelAllCommand } from './cancel-all.js';
import { registerListCommand } from './list.js';

export function registerOrderCommands(perps: Command): void {
  const order = perps
    .command('order')
    .description('Order management and trading');

  registerMarketCommand(order);
  registerLimitCommand(order);
  registerCancelCommand(order);
  registerCancelAllCommand(order);
  registerListCommand(order);
}
