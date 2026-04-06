import { readFileSync, existsSync } from 'node:fs';
import { CLAW_CONFIG } from './paths.js';
import type { Address } from 'viem';

export interface ClawWallet {
  address: Address;
  token: string;
  type: string;
}

export interface ClawConfig {
  baseUrl: string;
  wallets: ClawWallet[];
}

export function readClawConfig(): ClawConfig {
  if (!existsSync(CLAW_CONFIG)) {
    throw new Error(`Config file not found: ${CLAW_CONFIG}`);
  }
  const content = readFileSync(CLAW_CONFIG, 'utf-8');
  return JSON.parse(content) as ClawConfig;
}

export function getEvmWallet(): ClawWallet {
  const config = readClawConfig();
  const wallet = config.wallets.find((w) => w.type === 'evm');
  if (!wallet) {
    throw new Error('No EVM wallet found in config');
  }
  return wallet;
}

export function getBaseUrl(): string {
  const config = readClawConfig();
  if (!config.baseUrl) {
    throw new Error('baseUrl not found in config');
  }
  return config.baseUrl;
}
