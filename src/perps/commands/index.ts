import type { Command } from 'commander';
import { registerAccountCommands } from './account/index.js';
import { registerOrderCommands } from './order/index.js';
import { registerPositionCommands } from './position/index.js';
import { registerSignalCommands } from './signal/index.js';
import { registerCatalogCommand } from './catalog.js';

export function registerPerpsCommands(perps: Command): void {
  registerAccountCommands(perps);
  registerOrderCommands(perps);
  registerPositionCommands(perps);
  registerSignalCommands(perps);
  registerCatalogCommand(perps);
}
