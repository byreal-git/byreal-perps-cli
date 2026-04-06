import { homedir } from 'node:os';
import { join } from 'node:path';

export const PERPS_DIR = join(homedir(), '.byreal-perps');
export const CLAW_CONFIG = join(homedir(), '.openclaw', 'realclaw-config.json');
export const DB_PATH = join(PERPS_DIR, 'perps.db');
export const ORDER_CONFIG_PATH = join(PERPS_DIR, 'order-config.json');
