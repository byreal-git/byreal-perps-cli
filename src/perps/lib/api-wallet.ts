import { generatePrivateKey, privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { HttpTransport, InfoClient, ExchangeClient } from '@nktkas/hyperliquid';
import type { Address, Hex } from 'viem';
import axios from 'axios';
import https from 'node:https';
import {
  HL_AGENT_VALIDITY_DAYS,
} from '../constants.js';

// Force IPv4 to avoid IPv6 timeout issues
const httpsAgent = new https.Agent({ family: 4 });
const apiClient = axios.create({ httpsAgent });

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


async function privySignTypedData(
  agentToken: string,
  typedData: { domain: any; types: any; primaryType: string; message: any },
  baseUrl: string,
): Promise<{ signature: Hex }> {
  const url = `${baseUrl}/byreal/api/privy-proxy/v1/sign/evm-typed-data`;
  const chainId = typedData?.domain?.chainId || '42161'
  const requestBody = { caip2: `eip155:${chainId}`, typedData };

  const { data: body } = await apiClient.post<{
    retCode: number;
    retMsg: string;
    result: {
      success: boolean;
      retCode: number;
      retMsg: string;
      data?: { data?: { signature?: string } } | null;
    };
  }>(url, requestBody, {
    headers: { 'Authorization': `Bearer ${agentToken}` },
  });

  const result = body.result;

  if (!result?.success || !result.data?.data?.signature) {
    throw new Error(`Privy signing failed: [${result?.retCode}] ${result?.retMsg}`);
  }

  return { signature: result.data.data.signature as Hex };
}

export interface ServerSigningAccount {
  address: Address;
  signTypedData(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

export function createServerSigningAccount(token: string, walletAddress: `0x${string}`, baseUrl: string): ServerSigningAccount {
  return {
    address: walletAddress,
    async signTypedData(typedData) {
      const result = await privySignTypedData(token, typedData, baseUrl);
      return result.signature;
    },
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
  masterAccount: LocalAccount | ServerSigningAccount,
): Promise<ApproveAgentResult> {
  const masterAddress = masterAccount.address;

  // Generate a new agent wallet
  const agent = generateAgentWallet();

  const transport = new HttpTransport();
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
): Promise<ValidateAgentResult> {
  const account = privateKeyToAccount(agentPrivateKey);
  const agentAddress = account.address;

  const transport = new HttpTransport();
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
