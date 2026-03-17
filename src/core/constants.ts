/**
 * Constants for Byreal Perps CLI
 */

// ============================================
// Version
// ============================================

declare const __BYREAL_CLI_VERSION__: string | undefined;

const INJECTED_VERSION =
  typeof __BYREAL_CLI_VERSION__ === 'string'
    ? __BYREAL_CLI_VERSION__
    : undefined;

export const VERSION = INJECTED_VERSION ?? process.env.npm_package_version ?? '0.0.0';
export const CLI_NAME = 'byreal-perps-cli';
export const GITHUB_REPO = 'byreal-git/byreal-perps-cli';

// ============================================
// Table Configuration
// ============================================

export const TABLE_CHARS = {
  top: '',
  'top-mid': '',
  'top-left': '',
  'top-right': '',
  bottom: '',
  'bottom-mid': '',
  'bottom-left': '',
  'bottom-right': '',
  left: '',
  'left-mid': '',
  mid: '',
  'mid-mid': '',
  right: '',
  'right-mid': '',
  middle: ' ',
} as const;

// ============================================
// ASCII Art
// ============================================

export const LOGO = `
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ██████╗ ██╗   ██╗██████╗ ███████╗ █████╗ ██╗               ║
║   ██╔══██╗╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██║               ║
║   ██████╔╝ ╚████╔╝ ██████╔╝█████╗  ███████║██║               ║
║   ██╔══██╗  ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██║██║               ║
║   ██████╔╝   ██║   ██║  ██║███████╗██║  ██║███████╗          ║
║   ╚═════╝    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝          ║
║                                                              ║
║   Perps CLI — Hyperliquid Perpetual Futures                  ║
║   https://byreal.io/en/perps                                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

export const EXPERIMENTAL_WARNING = `
⚠️  WARNING: This CLI is experimental and under active development.
    Use at your own risk. Always verify transactions before confirming.
`;
