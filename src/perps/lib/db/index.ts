import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { PERPS_DIR, DB_PATH } from '../paths.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  mkdirSync(PERPS_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  const migrations = [
    {
      name: '001_create_accounts',
      sql: `
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          alias TEXT NOT NULL UNIQUE,
          master_address TEXT NOT NULL,
          agent_private_key TEXT NOT NULL,
          agent_address TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'agent_wallet' CHECK (type IN ('agent_wallet')),
          source TEXT NOT NULL DEFAULT 'cli_import',
          is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_perps_accounts_is_default ON accounts(is_default);
        CREATE INDEX IF NOT EXISTS idx_perps_accounts_master_address ON accounts(master_address);
      `,
    },
    {
      name: '002_add_expires_at',
      sql: `
        ALTER TABLE accounts ADD COLUMN expires_at INTEGER;
      `,
    },
  ];

  const appliedMigrations = db
    .prepare('SELECT name FROM migrations')
    .all() as { name: string }[];
  const appliedNames = new Set(appliedMigrations.map((m) => m.name));

  const applyMigration = db.transaction(
    (migration: { name: string; sql: string }) => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(
        migration.name,
      );
    },
  );

  for (const migration of migrations) {
    if (!appliedNames.has(migration.name)) {
      applyMigration(migration);
    }
  }
}

export * from './accounts.js';
