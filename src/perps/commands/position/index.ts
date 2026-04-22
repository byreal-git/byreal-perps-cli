import type { Command } from 'commander';
import { registerPositionListCommand } from './list.js';
import { registerLeverageCommand } from './leverage.js';
import { registerMarginModeCommand } from './margin-mode.js';
import { registerCloseMarketCommand } from './close-market.js';
import { registerCloseLimitCommand } from './close-limit.js';
import { registerCloseAllCommand } from './close-all.js';
import { registerTpSlCommand } from './tpsl.js';
import { registerMarginCommand } from './margin.js';

export function registerPositionCommands(perps: Command): void {
  const position = perps
    .command('position')
    .description('Position management');

  registerPositionListCommand(position);
  registerLeverageCommand(position);
  registerMarginModeCommand(position);
  registerMarginCommand(position);
  registerTpSlCommand(position);

  registerCloseMarketCommand(position);
  registerCloseLimitCommand(position);
  registerCloseAllCommand(position);
}
