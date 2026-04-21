import { Command } from "commander";
import { getPerpsOutputOptions } from "../../cli/program.js";
import { output, outputError, outputSuccess } from "../../cli/output.js";
import {
  approveAgentWithMasterKey,
  createServerSigningAccount,
} from "../../lib/api-wallet.js";
import { getEvmWallet, getBaseUrl } from "../../lib/claw-config.js";
import {
  createPerpsAccount,
  isPerpsAliasTaken,
  getPerpsAccountCount,
  getExpiredAccounts,
  deleteExpiredAccounts,
} from "../../lib/db/index.js";

export function registerInitCommand(account: Command): void {
  account
    .command("init")
    .description("Interactive setup wizard for perps trading")
    .option("--default", "Set as default account", true)
    .option("--no-default", "Do not set as default account")
    .action(async function (this: Command, options: { default?: boolean }) {
      const outputOpts = getPerpsOutputOptions(this);
      try {
        if (!outputOpts.json) console.log("\n=== Byreal Perps Account Setup ===\n");
        cleanupExpiredAccounts();

        const setDefault = resolveDefault(options);
        const alias = generateAutoAlias();

        await handleTokenAgent(alias, setDefault, outputOpts);
      } catch (err) {
        outputError(
          err instanceof Error ? err.message : String(err),
          outputOpts,
          "ACCOUNT_INIT_ERROR",
        );
        process.exit(1);
      }
    });
}

function generateAutoAlias(): string {
  const base = `account-${Date.now()}`;
  if (!isPerpsAliasTaken(base)) return base;
  return `account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveDefault(options: { default?: boolean }): boolean {
  const existingCount = getPerpsAccountCount();
  if (existingCount === 0) return true;
  return options.default ?? true;
}

function cleanupExpiredAccounts(): void {
  const expired = getExpiredAccounts();
  if (expired.length === 0) return;
  deleteExpiredAccounts();
}

async function handleTokenAgent(
  alias: string,
  setAsDefault: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const evmWallet = getEvmWallet();
  const baseUrl = getBaseUrl();
  const token = evmWallet.token;
  const walletAddress = evmWallet.address;
  if (!outputOpts.json) console.log("Resolving wallet address from token...");
  const masterAccount = createServerSigningAccount(
    token,
    walletAddress,
    baseUrl,
  );

  if (!outputOpts.json) console.log("Generating agent wallet and signing approval via server...");
  const result = await approveAgentWithMasterKey(masterAccount);
  if (!outputOpts.json) console.log(`Agent wallet approved: ${result.agentAddress}`);

  const newAccount = createPerpsAccount({
    alias,
    masterAddress: result.masterAddress,
    agentPrivateKey: result.agentPrivateKey,
    agentAddress: result.agentAddress,
    expiresAt: result.expiresAt,
    setAsDefault,
  });

  printResult(newAccount, outputOpts);
}

function printResult(
  account: {
    alias: string;
    masterAddress: string;
    agentAddress: string;
    isDefault: boolean;
    agentPrivateKey: string;
  },
  outputOpts: { json: boolean },
  message?: string,
): void {
  if (outputOpts.json) {
    output({ ...account, agentPrivateKey: "[REDACTED]" }, outputOpts);
  } else {
    console.log("");
    outputSuccess(message ?? `Account "${account.alias}" added successfully!`);
    console.log("");
    console.log("Account details:");
    console.log(`  Alias: ${account.alias}`);
    console.log(`  Master: ${account.masterAddress}`);
    console.log(`  Agent: ${account.agentAddress}`);
    console.log(`  Default: ${account.isDefault ? "Yes" : "No"}`);
    console.log("");
  }
}
