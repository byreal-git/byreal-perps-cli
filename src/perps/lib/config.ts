import type { Hex, Address } from 'viem';
import type { PerpsConfig } from '../types.js';
import { getDefaultPerpsAccount, isAccountExpired, deletePerpsAccount } from './db/index.js';

export function loadPerpsConfig(testnet: boolean): PerpsConfig {
  // 1. Try DB default account first
  let defaultAccount = null;
  try {
    defaultAccount = getDefaultPerpsAccount();
  } catch {
    // DB may not exist yet
  }

  if (defaultAccount) {
    if (isAccountExpired(defaultAccount)) {
      deletePerpsAccount(defaultAccount.alias);
      defaultAccount = null;
    }
  }

  if (defaultAccount) {
    return {
      agentPrivateKey: defaultAccount.agentPrivateKey,
      masterAddress: defaultAccount.masterAddress,
      testnet,
      account: {
        alias: defaultAccount.alias,
        type: defaultAccount.type,
      },
    };
  }

  // Fall back to environment variables
  const agentPrivateKey = process.env.BYREAL_PERPS_AGENT_KEY as Hex | undefined;
  const masterAddress = process.env.BYREAL_PERPS_WALLET_ADDRESS as Address | undefined;

  if (!agentPrivateKey || !masterAddress) {
    console.warn(
      'No perps account configured. Run "byreal-cli perps account init" to set up a new one.',
    );
  }

  return {
    agentPrivateKey,
    masterAddress,
    testnet,
  };
}

