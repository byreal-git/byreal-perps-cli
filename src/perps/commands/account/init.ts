import { Command } from "commander";
import { getPerpsContext, getPerpsOutputOptions } from "../../cli/program.js";
import { output, outputError, outputSuccess } from "../../cli/output.js";
import { promptPassword } from "../../lib/prompts.js";
import { validatePrivateKey } from "../../lib/validation.js";
import {
  validateAgent,
  approveAgentWithMasterKey,
  createServerSigningAccount,
} from "../../lib/api-wallet.js";
import { getEvmWallet, getBaseUrl } from "../../lib/claw-config.js";
import {
  createPerpsAccount,
  isPerpsAliasTaken,
  getPerpsAccountCount,
  getPerpsAccountByAgentKey,
  setDefaultPerpsAccount,
  getExpiredAccounts,
  deleteExpiredAccounts,
} from "../../lib/db/index.js";
import { privateKeyToAccount } from "viem/accounts";

interface InitOptions {
  agentKey?: string;
  masterKey?: string;
  method?: "generate" | "token";
  default?: boolean;
  nonInteractive?: boolean;
}

export function registerInitCommand(account: Command): void {
  account
    .command("init")
    .description("Interactive setup wizard for perps trading")
    .option("--agent-key <key>", "Import an existing agent wallet private key")
    .option(
      "--master-key <key>",
      "EVM wallet private key (for generate method)",
    )
    .option(
      "--method <method>",
      'Setup method: "generate" or "token"',
      validateMethod,
    )
    .option("--default", "Set as default account", true)
    .option("--no-default", "Do not set as default account")
    .option(
      "--non-interactive",
      "Run without interactive prompts (requires relevant keys)",
    )
    .action(async function (this: Command, options: InitOptions) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);
      try {
        console.log("\n=== Byreal Perps Account Setup ===\n");
        cleanupExpiredAccounts();

        const setDefault = resolveDefault(options);
        const alias = generateAutoAlias();

        // --agent-key: import existing agent key directly
        if (options.agentKey) {
          await handleExistingAgentKey(
            options.agentKey,
            alias,
            setDefault,
            outputOpts,
          );
          return;
        }

        const method = options.method ?? "token";

        if (method === "generate") {
          if (
            (options.nonInteractive || outputOpts.json) &&
            !options.masterKey
          ) {
            throw new Error(
              "Non-interactive mode requires --master-key for generate method",
            );
          }
          const masterKeyInput =
            options.masterKey ??
            (await promptPassword(
              "Enter your EVM wallet private key (0x...): ",
            ));
          await handleGenerateAgent(
            masterKeyInput,
            alias,
            setDefault,
            outputOpts,
          );
        } else {
          await handleTokenAgent(alias, setDefault, outputOpts);
        }
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

function validateMethod(value: string): "generate" | "token" {
  if (value === "generate" || value === "token") return value;
  throw new Error('Method must be "generate" or "token"');
}

function generateAutoAlias(): string {
  const base = `account-${Date.now()}`;
  if (!isPerpsAliasTaken(base)) return base;
  return `account-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveDefault(options: InitOptions): boolean {
  const existingCount = getPerpsAccountCount();
  if (existingCount === 0) return true;
  return options.default ?? true;
}

function cleanupExpiredAccounts(): void {
  const expired = getExpiredAccounts();
  if (expired.length === 0) return;
  deleteExpiredAccounts();
}

async function handleExistingAgentKey(
  keyInput: string,
  alias: string,
  setAsDefault: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const agentPrivateKey = validatePrivateKey(keyInput);

  // Check if this key already exists in DB — reuse and set as default
  const existing = getPerpsAccountByAgentKey(agentPrivateKey);
  if (existing) {
    const account = existing.isDefault
      ? existing
      : setDefaultPerpsAccount(existing.alias);
    printResult(
      account,
      outputOpts,
      `Account "${account.alias}" already exists, set as default.`,
    );
    return;
  }

  console.log("\nValidating agent wallet...");
  const result = await validateAgent(agentPrivateKey);

  if (!result.valid) {
    throw new Error(result.error);
  }

  const masterAddress = result.masterAddress;
  const agentAddress = result.agentAddress;

  console.log(
    `Valid agent wallet for ${masterAddress.slice(0, 6)}...${masterAddress.slice(-4)}`,
  );

  const newAccount = createPerpsAccount({
    alias,
    masterAddress,
    agentPrivateKey,
    agentAddress,
    setAsDefault,
  });

  printResult(newAccount, outputOpts);
}

async function handleGenerateAgent(
  masterKeyInput: string,
  alias: string,
  setAsDefault: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const masterPrivateKey = validatePrivateKey(masterKeyInput);
  const masterAccount = privateKeyToAccount(masterPrivateKey);

  console.log("Generating agent wallet and signing approval...");
  const result = await approveAgentWithMasterKey(masterAccount);
  console.log(`Agent wallet approved: ${result.agentAddress}`);

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

async function handleTokenAgent(
  alias: string,
  setAsDefault: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const evmWallet = getEvmWallet();
  const baseUrl = getBaseUrl();
  const token = evmWallet.token;
  const walletAddress = evmWallet.address;
  console.log("Resolving wallet address from token...");
  const masterAccount = createServerSigningAccount(
    token,
    walletAddress,
    baseUrl,
  );

  console.log("Generating agent wallet and signing approval via server...");
  const result = await approveAgentWithMasterKey(masterAccount);
  console.log(`Agent wallet approved: ${result.agentAddress}`);

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
