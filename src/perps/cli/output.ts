import chalk from 'chalk';
import Table from 'cli-table3';
import { TABLE_CHARS, VERSION } from '../../core/constants.js';
import type { PerpsOutputOptions } from '../types.js';

// ============================================
// Table Helpers (aligned with src/cli/output/formatters.ts)
// ============================================

function createTable(headers: string[]): Table.Table {
  return new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    chars: TABLE_CHARS,
    style: {
      head: [],
      border: [],
      'padding-left': 1,
      'padding-right': 1,
    },
  });
}

// ============================================
// JSON Output
// ============================================

function outputJson(data: unknown): void {
  console.log(JSON.stringify({
    success: true,
    meta: {
      timestamp: new Date().toISOString(),
      version: VERSION,
    },
    data,
  }, null, 2));
}

// ============================================
// Public API (signature unchanged for consumers)
// ============================================

export function output(data: unknown, opts: PerpsOutputOptions): void {
  if (opts.json) {
    outputJson(data);
  } else {
    if (typeof data === 'string') {
      console.log(data);
    } else if (Array.isArray(data)) {
      formatArray(data);
    } else if (typeof data === 'object' && data !== null) {
      formatObject(data as Record<string, unknown>);
    } else {
      console.log(data);
    }
  }
}

export function outputError(message: string, opts?: PerpsOutputOptions, code?: string): void {
  if (opts?.json) {
    console.log(JSON.stringify({
      success: false,
      meta: {
        timestamp: new Date().toISOString(),
        version: VERSION,
      },
      error: { code: code ?? 'UNKNOWN_ERROR', message },
    }, null, 2));
  } else {
    console.error(chalk.red.bold(`Error: ${message}`));
  }
}

export function outputSuccess(message: string): void {
  console.log(chalk.green(message));
}

// ============================================
// Formatters
// ============================================

function formatArray(arr: unknown[]): void {
  if (arr.length === 0) {
    console.log(chalk.gray('(empty)'));
    return;
  }

  const first = arr[0];
  if (typeof first === 'object' && first !== null) {
    const keys = Object.keys(first);
    const table = createTable(keys);

    for (const item of arr) {
      const row = keys.map((k) => {
        const val = (item as Record<string, unknown>)[k];
        return String(val ?? '');
      });
      table.push(row);
    }

    console.log(table.toString());
  } else {
    for (const item of arr) {
      console.log(item);
    }
  }
}

function formatObject(obj: Record<string, unknown>, indent = 0): void {
  if (indent === 0) {
    // Top-level object: render as a key-value table
    const table = createTable(['Field', 'Value']);
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        table.push([chalk.white(key), chalk.gray(JSON.stringify(value))]);
      } else if (Array.isArray(value)) {
        table.push([chalk.white(key), chalk.gray(`[${value.length} items]`)]);
      } else {
        table.push([chalk.white(key), String(value ?? '')]);
      }
    }
    console.log(table.toString());
  } else {
    // Nested: keep indented text form
    const prefix = '  '.repeat(indent);
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        console.log(`${prefix}${chalk.white(key)}:`);
        formatObject(value as Record<string, unknown>, indent + 1);
      } else if (Array.isArray(value)) {
        console.log(`${prefix}${chalk.white(key)}: ${chalk.gray(`[${value.length} items]`)}`);
      } else {
        console.log(`${prefix}${chalk.white(key)}: ${value}`);
      }
    }
  }
}
