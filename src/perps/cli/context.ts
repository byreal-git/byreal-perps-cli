import {
  HttpTransport,
  WebSocketTransport,
  InfoClient,
  ExchangeClient,
  SubscriptionClient,
} from '@nktkas/hyperliquid';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import WebSocket from 'ws';
import type { PerpsConfig } from '../types.js';

// Polyfill CloseEvent for Node.js < 22 (used by @nktkas/rews)
if (typeof (globalThis as any).CloseEvent === 'undefined') {
  (globalThis as any).CloseEvent = class CloseEvent extends Event {
    code: number;
    reason: string;
    wasClean: boolean;
    constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) {
      super(type);
      this.code = init.code ?? 0;
      this.reason = init.reason ?? '';
      this.wasClean = init.wasClean ?? false;
    }
  };
}

export interface PerpsContext {
  config: PerpsConfig;
  getPublicClient(): InfoClient;
  getWalletClient(): ExchangeClient;
  getSubscriptionClient(): SubscriptionClient;
  getWalletAddress(): Address;
  closeWebSocket(): Promise<void>;
}

export function createPerpsContext(config: PerpsConfig): PerpsContext {
  let publicClient: InfoClient | null = null;
  let walletClient: ExchangeClient | null = null;
  let subscriptionClient: SubscriptionClient | null = null;
  let wsTransport: WebSocketTransport | null = null;

  const transport = new HttpTransport();

  return {
    config,

    getPublicClient(): InfoClient {
      if (!publicClient) {
        publicClient = new InfoClient({ transport });
      }
      return publicClient;
    },

    getWalletClient(): ExchangeClient {
      if (!walletClient) {
        if (!config.agentPrivateKey) {
          throw new Error(
            'No perps account configured. Run "byreal-perps-cli perps account init" to set up.',
          );
        }
        const account = privateKeyToAccount(config.agentPrivateKey as Hex);
        walletClient = new ExchangeClient({ transport, wallet: account });
      }
      return walletClient;
    },

    getWalletAddress(): Address {
      if (config.masterAddress) {
        return config.masterAddress;
      }
      if (config.agentPrivateKey) {
        const account = privateKeyToAccount(config.agentPrivateKey as Hex);
        return account.address;
      }
      throw new Error(
        'No perps account configured. Run "byreal-perps-cli perps account init" to set up.',
      );
    },

    getSubscriptionClient(): SubscriptionClient {
      if (!subscriptionClient) {
        wsTransport = new WebSocketTransport({
          reconnect: { WebSocket: WebSocket as unknown as typeof globalThis.WebSocket },
        });
        subscriptionClient = new SubscriptionClient({ transport: wsTransport });
      }
      return subscriptionClient;
    },

    async closeWebSocket(): Promise<void> {
      if (wsTransport) {
        await wsTransport.close();
        wsTransport = null;
        subscriptionClient = null;
      }
    },
  };
}
