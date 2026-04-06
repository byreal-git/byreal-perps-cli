import { Command } from 'commander';
import { type PerpsContext } from './context.js';
import type { PerpsOutputOptions } from '../types.js';

export function getPerpsContext(command: Command): PerpsContext {
  let current: Command | null = command;
  while (current) {
    const ctx = current.opts()._context as PerpsContext | undefined;
    if (ctx) return ctx;
    current = current.parent;
  }
  throw new Error('Perps context not found');
}

export function getPerpsOutputOptions(command: Command): PerpsOutputOptions {
  let current: Command | null = command;
  while (current) {
    const opts = current.opts()._outputOpts as PerpsOutputOptions | undefined;
    if (opts) return opts;
    current = current.parent;
  }
  return { json: false };
}
