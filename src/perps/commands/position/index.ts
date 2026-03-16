import type { Command } from 'commander';
import { registerPositionListCommand } from './list.js';
import { registerLeverageCommand } from './leverage.js';
import { registerCloseMarketCommand } from './close-market.js';
import { registerCloseLimitCommand } from './close-limit.js';
import { registerCloseAllCommand } from './close-all.js';

export function registerPositionCommands(perps: Command): void {
  const position = perps
    .command('position')
    .description('Position management');

  registerPositionListCommand(position);
  registerLeverageCommand(position);

  registerCloseMarketCommand(position);
  registerCloseLimitCommand(position);
  registerCloseAllCommand(position);
}
