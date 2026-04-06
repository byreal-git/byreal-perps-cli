# Byreal Perps CLI - Project Rules

## Display Rules

- **Never abbreviate on-chain addresses**: In both table and JSON output, always display addresses in full. Never truncate with `...`.

## Commit Convention

- All commit messages must be in English
- Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`

## Architecture

- `src/index.ts` — CLI entry point
- `src/core/` — Shared constants (VERSION, TABLE_CHARS) and update checker
- `src/perps/cli/` — Perps command definitions, context, and output formatting
- `src/perps/commands/` — Command implementations (account, order, position, signal)
- `src/perps/lib/` — Config, database, validation, API wallet, prompts, OpenClaw config reader
- `skills/` — AI skill definition for LLM integration
