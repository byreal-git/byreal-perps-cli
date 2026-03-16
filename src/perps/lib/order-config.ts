import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { ORDER_CONFIG_PATH } from './paths.js';
import { HL_MARKET_SLIPPAGE_PCT, HL_DEFAULT_LEVERAGE } from '../constants.js';

export interface OrderConfig {
  slippage: number;
  defaultLeverage: number;
}

const DEFAULT_CONFIG: OrderConfig = {
  slippage: HL_MARKET_SLIPPAGE_PCT,
  defaultLeverage: HL_DEFAULT_LEVERAGE,
};

export function getOrderConfig(): OrderConfig {
  try {
    if (!existsSync(ORDER_CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG };
    }
    const content = readFileSync(ORDER_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(content) as Partial<OrderConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function updateOrderConfig(updates: Partial<OrderConfig>): OrderConfig {
  const dir = dirname(ORDER_CONFIG_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const current = getOrderConfig();
  const updated: OrderConfig = { ...current, ...updates };
  writeFileSync(ORDER_CONFIG_PATH, JSON.stringify(updated, null, 2));
  return updated;
}
