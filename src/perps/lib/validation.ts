import type { Address, Hex } from 'viem';
import type { OrderSide, TimeInForce } from '../types.js';
import { HL_MAX_LEVERAGE } from '../constants.js';

export function validateCoin(value: string): string {
  const coin = value.toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(coin)) {
    throw new Error(`Invalid coin symbol: ${value}`);
  }
  return coin;
}

export function validateSideWithAliases(value: string): OrderSide {
  const lower = value.toLowerCase();
  if (lower === 'long' || lower === 'buy') return 'buy';
  if (lower === 'short' || lower === 'sell') return 'sell';
  throw new Error('Side must be "buy", "sell", "long", or "short"');
}

export function validatePositiveNumber(value: string, name: string): number {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return num;
}

export function validatePositiveInteger(value: string, name: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return num;
}

export function validateLeverage(value: string): number {
  const leverage = parseInt(value, 10);
  if (isNaN(leverage) || leverage < 1 || leverage > HL_MAX_LEVERAGE) {
    throw new Error(`Leverage must be between 1 and ${HL_MAX_LEVERAGE}`);
  }
  return leverage;
}

export function validateTif(value: string): TimeInForce {
  const mapping: Record<string, TimeInForce> = {
    gtc: 'Gtc',
    ioc: 'Ioc',
    alo: 'Alo',
  };
  const result = mapping[value.toLowerCase()];
  if (!result) {
    throw new Error('Time-in-force must be "Gtc", "Ioc", or "Alo"');
  }
  return result;
}

export function validateAddress(value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value as Address;
}

export function validatePrivateKey(value: string): Hex {
  let key = value;
  if (!key.startsWith('0x')) {
    key = `0x${key}`;
  }
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) {
    throw new Error('Invalid private key format. Must be a 64-character hex string.');
  }
  return key as Hex;
}
