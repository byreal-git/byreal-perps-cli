import { Command } from 'commander';
import { getPerpsContext, getPerpsOutputOptions } from '../../cli/program.js';
import { output, outputError, outputSuccess } from '../../cli/output.js';
import { prompt, promptPassword } from '../../lib/prompts.js';
import { validatePrivateKey } from '../../lib/validation.js';
import {
  validateAgent,
  approveAgentWithMasterKey,
} from '../../lib/api-wallet.js';
import {
  createPerpsAccount,
  isPerpsAliasTaken,
  getPerpsAccountCount,
  getPerpsAccountByAgentKey,
  setDefaultPerpsAccount,
  getExpiredAccounts,
  deleteExpiredAccounts,
} from '../../lib/db/index.js';
import { privateKeyToAccount } from 'viem/accounts';

interface InitOptions {
  agentKey?: string;
  masterKey?: string;
  method?: 'existing' | 'generate';
  alias?: string;
  default?: boolean;
}

export function registerInitCommand(account: Command): void {
  account
    .command('init')
    .description('Interactive setup wizard for perps trading')
    .option('--agent-key <key>', 'Existing agent wallet private key')
    .option('--master-key <key>', 'EVM wallet private key (for generate method)')
    .option('--method <method>', 'Setup method: "existing" or "generate"', validateMethod)
    .option('--alias <name>', 'Account alias')
    .option('--default', 'Set as default account', true)
    .option('--no-default', 'Do not set as default account')
    .action(async function (this: Command, options: InitOptions) {
      const ctx = getPerpsContext(this);
      const outputOpts = getPerpsOutputOptions(this);
      const isTestnet = ctx.config.testnet;

      try {
        console.log('\n=== Byreal Perps Account Setup ===\n');
        cleanupExpiredAccounts()
        // Fast path: --agent-key provided directly
        if (options.agentKey) {
          const setDefault = resolveDefault(options);
          await handleExistingAgentKey(options.agentKey, options.alias ?? null, setDefault, isTestnet, outputOpts);
          return;
        }

        // Determine method
        const method = options.method ?? await askMethod();

        if (method === 'existing') {
          const keyInput = options.agentKey ?? await promptPassword('Enter your API wallet private key: ');
          const setDefault = resolveDefault(options);
          await handleExistingAgentKey(keyInput, options.alias ?? null, setDefault, isTestnet, outputOpts);
        } else {
          const masterKeyInput = options.masterKey ?? await promptPassword('Enter your EVM wallet private key (0x...): ');
          const alias = options.alias ?? await promptForAlias();
          const setDefault = resolveDefault(options);
          await handleGenerateAgent(masterKeyInput, alias, setDefault, isTestnet, outputOpts);
        }
      } catch (err) {
        outputError(err instanceof Error ? err.message : String(err), outputOpts);
        process.exit(1);
      }
    });
}

function validateMethod(value: string): 'existing' | 'generate' {
  if (value === 'existing' || value === 'generate') return value;
  throw new Error('Method must be "existing" or "generate"');
}

async function askMethod(): Promise<'existing' | 'generate'> {
  const { select } = await import('../../lib/prompts.js');
  console.log('This wizard will help you set up your Hyperliquid perps trading account.\n');
  console.log('You can either:');
  console.log('  1. Import an existing API wallet key from Hyperliquid');
  console.log('  2. Generate a new agent wallet using your EVM private key\n');
  return select<'existing' | 'generate'>(
    'How would you like to set up?',
    [
      { value: 'existing', label: 'Import existing API wallet key' },
      { value: 'generate', label: 'Generate new agent wallet (sign with EVM private key)' },
    ],
  );
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
  alias: string | null,
  setAsDefault: boolean,
  isTestnet: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const agentPrivateKey = validatePrivateKey(keyInput);

  // Check if this key already exists in DB — reuse and set as default
  const existing = getPerpsAccountByAgentKey(agentPrivateKey);
  if (existing) {
    const account = existing.isDefault ? existing : setDefaultPerpsAccount(existing.alias);
    printResult(account, outputOpts, `Account "${account.alias}" already exists, set as default.`);
    return;
  }

  // New key — alias is required
  const resolvedAlias = alias ?? await promptForAlias();

  console.log('\nValidating agent wallet...');
  const result = await validateAgent(agentPrivateKey, isTestnet);

  if (!result.valid) {
    throw new Error(result.error);
  }

  const masterAddress = result.masterAddress;
  const agentAddress = result.agentAddress;

  console.log(`Valid agent wallet for ${masterAddress.slice(0, 6)}...${masterAddress.slice(-4)}`);

  const newAccount = createPerpsAccount({
    alias: resolvedAlias,
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
  isTestnet: boolean,
  outputOpts: { json: boolean },
): Promise<void> {
  const masterPrivateKey = validatePrivateKey(masterKeyInput);
  const masterAccount = privateKeyToAccount(masterPrivateKey);

  console.log('Generating agent wallet and signing approval...');
  const result = await approveAgentWithMasterKey(masterAccount, isTestnet);
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
  account: { alias: string; masterAddress: string; agentAddress: string; isDefault: boolean; agentPrivateKey: string },
  outputOpts: { json: boolean },
  message?: string,
): void {
  if (outputOpts.json) {
    output(
      { ...account, agentPrivateKey: '[REDACTED]' },
      outputOpts,
    );
  } else {
    console.log('');
    outputSuccess(message ?? `Account "${account.alias}" added successfully!`);
    console.log('');
    console.log('Account details:');
    console.log(`  Alias: ${account.alias}`);
    console.log(`  Master: ${account.masterAddress}`);
    console.log(`  Agent: ${account.agentAddress}`);
    console.log(`  Default: ${account.isDefault ? 'Yes' : 'No'}`);
    console.log('');
  }
}

async function promptForAlias(): Promise<string> {
  while (true) {
    const alias = await prompt("Enter an alias for this account (e.g., 'main', 'trading'): ");
    if (!alias) {
      console.log('Alias cannot be empty.');
      continue;
    }
    if (isPerpsAliasTaken(alias)) {
      console.log(`Alias "${alias}" is already taken. Please choose another.`);
      continue;
    }
    return alias;
  }
}
