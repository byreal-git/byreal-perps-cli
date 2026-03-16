import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { HttpTransport, InfoClient, ExchangeClient } from '@nktkas/hyperliquid';
import type { Address, Hex } from 'viem';
import {
  HL_AGENT_VALIDITY_DAYS,
} from '../constants.js';

export interface AgentWalletCredentials {
  privateKey: Hex;
  address: Address;
}

export function generateAgentWallet(): AgentWalletCredentials {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
  };
}

export interface ApproveAgentResult {
  agentPrivateKey: Hex;
  agentAddress: Address;
  masterAddress: Address;
  expiresAt: number;
}

/**
 * Generate an agent wallet and approve it using the master account.
 * This is the CLI equivalent of the frontend's approveAgentWithMasterWallet,
 * but uses a local account directly instead of browser wallet signing.
 */
export async function approveAgentWithMasterKey(
  masterAccount: LocalAccount,
  isTestnet: boolean = false,
): Promise<ApproveAgentResult> {
  const masterAddress = masterAccount.address;

  // Generate a new agent wallet
  const agent = generateAgentWallet();

  const transport = new HttpTransport({ isTestnet });
  const masterClient = new ExchangeClient({ transport, wallet: masterAccount });

  const validUntil = Date.now() + HL_AGENT_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  const agentName = `Byreal Agent Cli valid_until ${validUntil}`;

  // Approve agent wallet
  await masterClient.approveAgent({
    agentAddress: agent.address,
    agentName,
  });

  return {
    agentPrivateKey: agent.privateKey,
    agentAddress: agent.address,
    masterAddress,
    expiresAt: validUntil,
  };
}

export type ValidateAgentResult =
  | { valid: true; masterAddress: Address; agentAddress: Address }
  | { valid: false; error: string };

export type UserRoleResponse =
  | { role: 'missing' | 'user' | 'vault' }
  | { role: 'agent'; data: { user: Address } }
  | { role: 'subAccount'; data: { master: Address } };

export async function validateAgent(
  agentPrivateKey: Hex,
  isTestnet: boolean = false,
): Promise<ValidateAgentResult> {
  const account = privateKeyToAccount(agentPrivateKey);
  const agentAddress = account.address;

  const transport = new HttpTransport({ isTestnet });
  const client = new InfoClient({ transport });

  try {
    const response = (await client.userRole({ user: agentAddress })) as UserRoleResponse;

    if (response.role === 'agent') {
      return {
        valid: true,
        masterAddress: response.data.user,
        agentAddress,
      };
    }

    if (response.role === 'missing') {
      return { valid: false, error: 'This key is not registered as an agent wallet on Hyperliquid' };
    }

    return { valid: false, error: `Invalid role: ${response.role}. Expected an agent wallet.` };
  } catch (err) {
    return { valid: false, error: `Failed to validate agent: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function getApprovalUrl(isTestnet: boolean = false): string {
  return isTestnet
    ? 'https://app.hyperliquid-testnet.xyz/API'
    : 'https://app.hyperliquid.xyz/API';
}
