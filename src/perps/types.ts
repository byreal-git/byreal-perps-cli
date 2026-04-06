import type { Address, Hex } from 'viem';

// ============================================
// Config
// ============================================

export interface PerpsConfig {
  agentPrivateKey?: Hex;
  masterAddress?: Address;
  expiresAt?: number | null;
  account?: {
    alias: string;
    type: string;
  };
}

// ============================================
// DB Account
// ============================================

export type PerpsAccountType = 'agent_wallet';
export type PerpsAccountSource = 'cli_import';

export interface PerpsAccount {
  id: number;
  alias: string;
  masterAddress: Address;
  agentPrivateKey: Hex;
  agentAddress: Address;
  type: PerpsAccountType;
  source: PerpsAccountSource;
  isDefault: boolean;
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface PerpsAccountRow {
  id: number;
  alias: string;
  master_address: string;
  agent_private_key: string;
  agent_address: string;
  type: string;
  source: string;
  is_default: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CreatePerpsAccountInput {
  alias: string;
  masterAddress: Address;
  agentPrivateKey: Hex;
  agentAddress: Address;
  expiresAt?: number | null;
  setAsDefault?: boolean;
}

// ============================================
// Order types
// ============================================

export type OrderSide = 'buy' | 'sell';
export type TimeInForce = 'Gtc' | 'Ioc' | 'Alo';

export type OrderStatus =
  | string
  | { filled: { totalSz: string; avgPx: string; oid: number } }
  | { resting: { oid: number } };

// ============================================
// Position types
// ============================================

export interface PerpsPosition {
  coin: string;
  szi: string;
  entryPx: string;
  leverage: { type: 'cross' | 'isolated'; value: number };
  liquidationPx: string;
  marginUsed: string;
  positionValue: string;
  returnOnEquity: string;
  unrealizedPnl: string;
  isLong: boolean;
  absSize: number;
}

// ============================================
// Output options
// ============================================

export interface PerpsOutputOptions {
  json: boolean;
  yes?: boolean;
}
