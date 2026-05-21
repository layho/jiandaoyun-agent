/**
 * runtime/token.ts — V2 Token & API Key Runtime
 *
 * Manages API credentials securely. NEVER logs or exposes tokens.
 * All access through environment variables.
 */

import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env from project root
config({ path: resolve(__dirname, '..', '.env') });

/**
 * Get a credential. Throws if missing.
 * NEVER print the returned value to console.
 */
export function getCredential(key: string): string {
  const value = process.env[key];
  if (!value || value === '***') {
    throw new Error(`[TOKEN] Missing credential: ${key}. Check .env file.`);
  }
  return value;
}

/**
 * Get JDY_API_KEY — used for Open API calls.
 */
export function getApiKey(): string {
  return getCredential('JDY_API_KEY');
}

/**
 * Get JDY_USERNAME
 */
export function getUsername(): string {
  return getCredential('JDY_USERNAME');
}

/**
 * Get JDY_PASSWORD
 */
export function getPassword(): string {
  return getCredential('JDY_PASSWORD');
}

/**
 * Mask a token for safe logging.
 * Shows first 4 + last 4 characters.
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '…' + token.slice(-4);
}

/**
 * Build an Authorization header value.
 */
export function authHeader(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Rate-limit helper: wait the specified ms.
 */
export async function rateLimit(ms: number = 1000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
