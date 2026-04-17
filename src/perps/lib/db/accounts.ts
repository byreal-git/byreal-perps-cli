import type { Address, Hex } from 'viem';
import { getDb } from './index.js';
import type { PerpsAccount, PerpsAccountRow, CreatePerpsAccountInput } from '../../types.js';

function rowToAccount(row: PerpsAccountRow): PerpsAccount {
  return {
    id: row.id,
    alias: row.alias,
    masterAddress: row.master_address as Address,
    agentPrivateKey: row.agent_private_key as Hex,
    agentAddress: row.agent_address as Address,
    type: row.type as PerpsAccount['type'],
    source: row.source as PerpsAccount['source'],
    isDefault: row.is_default === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createPerpsAccount(input: CreatePerpsAccountInput): PerpsAccount {
  const db = getDb();

  const existing = db.prepare('SELECT * FROM accounts WHERE master_address = ?').get(input.masterAddress) as PerpsAccountRow | undefined;

  const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
  const shouldBeDefault = accountCount.count === 0 || input.setAsDefault;

  if (shouldBeDefault) {
    db.prepare('UPDATE accounts SET is_default = 0 WHERE is_default = 1').run();
  }

  if (existing) {
    db.prepare(`
      UPDATE accounts
      SET alias = ?, agent_private_key = ?, agent_address = ?, is_default = ?, expires_at = ?, updated_at = strftime('%s', 'now')
      WHERE master_address = ?
    `).run(
      input.alias,
      input.agentPrivateKey,
      input.agentAddress,
      shouldBeDefault ? 1 : 0,
      input.expiresAt ?? null,
      input.masterAddress,
    );

    return getPerpsAccountById(existing.id)!;
  }

  const result = db.prepare(`
    INSERT INTO accounts (alias, master_address, agent_private_key, agent_address, is_default, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.alias,
    input.masterAddress,
    input.agentPrivateKey,
    input.agentAddress,
    shouldBeDefault ? 1 : 0,
    input.expiresAt ?? null,
  );

  return getPerpsAccountById(Number(result.lastInsertRowid))!;
}

export function getPerpsAccountById(id: number): PerpsAccount | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as PerpsAccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getPerpsAccountByAlias(alias: string): PerpsAccount | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE alias = ?').get(alias) as PerpsAccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getDefaultPerpsAccount(): PerpsAccount | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE is_default = 1').get() as PerpsAccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function getAllPerpsAccounts(): PerpsAccount[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC').all() as PerpsAccountRow[];
  return rows.map(rowToAccount);
}

export function setDefaultPerpsAccount(alias: string): PerpsAccount {
  const db = getDb();

  const account = getPerpsAccountByAlias(alias);
  if (!account) {
    throw new Error(`Perps account with alias "${alias}" not found`);
  }

  db.prepare('UPDATE accounts SET is_default = 0 WHERE is_default = 1').run();
  db.prepare("UPDATE accounts SET is_default = 1, updated_at = strftime('%s', 'now') WHERE alias = ?").run(alias);

  return getPerpsAccountByAlias(alias)!;
}

export function deletePerpsAccount(alias: string): boolean {
  const db = getDb();
  const account = getPerpsAccountByAlias(alias);
  if (!account) return false;

  const wasDefault = account.isDefault;
  db.prepare('DELETE FROM accounts WHERE alias = ?').run(alias);

  if (wasDefault) {
    const firstAccount = db.prepare('SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1').get() as PerpsAccountRow | undefined;
    if (firstAccount) {
      db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(firstAccount.id);
    }
  }

  return true;
}

export function getPerpsAccountByAgentKey(agentPrivateKey: string): PerpsAccount | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM accounts WHERE agent_private_key = ?').get(agentPrivateKey) as PerpsAccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function isPerpsAliasTaken(alias: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM accounts WHERE alias = ?').get(alias);
  return row !== undefined;
}

export function getPerpsAccountCount(): number {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM accounts').get() as { count: number };
  return result.count;
}

export function isAccountExpired(account: PerpsAccount): boolean {
  if (!account.expiresAt) return false;
  return Date.now() > account.expiresAt;
}

export function getExpiredAccounts(): PerpsAccount[] {
  const db = getDb();
  const nowMs = Date.now();
  const rows = db.prepare(
    'SELECT * FROM accounts WHERE expires_at IS NOT NULL AND expires_at < ?',
  ).all(nowMs) as PerpsAccountRow[];
  return rows.map(rowToAccount);
}

export function deleteExpiredAccounts(): number {
  const db = getDb();
  const nowMs = Date.now();
  const result = db.prepare(
    'DELETE FROM accounts WHERE expires_at IS NOT NULL AND expires_at < ?',
  ).run(nowMs);

  if (result.changes > 0) {
    const hasDefault = db.prepare('SELECT 1 FROM accounts WHERE is_default = 1').get();
    if (!hasDefault) {
      const first = db.prepare('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1').get() as { id: number } | undefined;
      if (first) {
        db.prepare('UPDATE accounts SET is_default = 1 WHERE id = ?').run(first.id);
      }
    }
  }

  return result.changes;
}
