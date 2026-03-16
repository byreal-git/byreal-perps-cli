import type { Command } from 'commander';
import { registerScanCommand } from './scan.js';
import { registerDetailCommand } from './detail.js';

export function registerSignalCommands(perps: Command): void {
  const signal = perps
    .command('signal')
    .description('Market signal scanner and trading advisory');

  registerScanCommand(signal);
  registerDetailCommand(signal);
}
