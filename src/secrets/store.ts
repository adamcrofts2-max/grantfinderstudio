/**
 * Storage and verification of operator credentials.
 *
 * Rules that hold everywhere in this module:
 *   - a plaintext key exists only in the variable that received it
 *   - nothing here ever returns a plaintext key to a caller that renders HTML
 *   - a key is verified against the provider before it is trusted, and the
 *     outcome is recorded so the settings screen can be honest about it
 */

import type { Queryable } from '../db/client.js';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';

/**
 * Services the platform holds a secret for.
 *
 * 360Giving is deliberately absent: it is an open, unauthenticated API — no
 * key, no token — so it has settings but no credential. Adding a blank
 * credential row for it would invite somebody to paste something into it.
 */
export type ProviderId = 'anthropic' | 'companies_house';

export interface CredentialStatus {
  provider: ProviderId;
  /** Safe to render. Null when nothing is stored. */
  masked: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckNote: string | null;
}

export interface VerificationResult {
  ok: boolean;
  /** Shown to the operator. Never contains the key. */
  note: string;
}

interface CredentialRow {
  provider: ProviderId;
  masked: string;
  last_checked_at: string | null;
  last_check_ok: boolean | null;
  last_check_note: string | null;
}

export const PROVIDERS: ProviderId[] = ['anthropic', 'companies_house'];

/** Read what is configured. Returns display data only — never a secret. */
export async function readCredentialStatuses(
  db: Queryable,
): Promise<Record<ProviderId, CredentialStatus>> {
  const result = await db.query<CredentialRow>(
    `SELECT provider, masked, last_checked_at::text AS last_checked_at,
            last_check_ok, last_check_note
     FROM app_credentials`,
  );

  const byProvider = new Map(result.rows.map((row) => [row.provider, row]));
  const statuses = {} as Record<ProviderId, CredentialStatus>;

  for (const provider of PROVIDERS) {
    const row = byProvider.get(provider);
    statuses[provider] = {
      provider,
      masked: row?.masked ?? null,
      lastCheckedAt: row?.last_checked_at ?? null,
      lastCheckOk: row?.last_check_ok ?? null,
      lastCheckNote: row?.last_check_note ?? null,
    };
  }
  return statuses;
}

/** Store a key, encrypted, alongside the outcome of verifying it. */
export async function saveCredential(
  db: Queryable,
  provider: ProviderId,
  plaintext: string,
  masterKey: Buffer,
  verification: VerificationResult,
  /** The admin account making the change, never a customer. */
  updatedByAdmin: string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO app_credentials
       (provider, ciphertext, masked, last_checked_at, last_check_ok, last_check_note,
        updated_by_admin)
     VALUES ($1, $2, $3, now(), $4, $5, $6)
     ON CONFLICT (provider) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext,
       masked = EXCLUDED.masked,
       last_checked_at = EXCLUDED.last_checked_at,
       last_check_ok = EXCLUDED.last_check_ok,
       last_check_note = EXCLUDED.last_check_note,
       updated_by_admin = EXCLUDED.updated_by_admin,
       updated_at = now()`,
    [
      provider,
      encryptSecret(plaintext, masterKey),
      maskSecret(plaintext),
      verification.ok,
      verification.note,
      updatedByAdmin,
    ],
  );
}

/**
 * Record a fresh verification against the key already stored.
 *
 * Separate from `saveCredential` because it must NOT touch the ciphertext:
 * this is for re-testing a key without asking anybody to paste it again, and
 * a re-check that could rewrite the secret would be a way to lose it.
 *
 * It exists because a verdict outlives the code that reached it. The Companies
 * House check used to read a 404 as a bad key, which marked a working key as
 * failing — and deploying the fix changed nothing, because the check only ran
 * on save. Without this, recovering meant re-pasting a key that was never
 * wrong.
 */
export async function recordCredentialCheck(
  db: Queryable,
  provider: ProviderId,
  verification: VerificationResult,
  updatedByAdmin: string | null,
): Promise<void> {
  await db.query(
    `UPDATE app_credentials
        SET last_checked_at = now(),
            last_check_ok = $2,
            last_check_note = $3,
            updated_by_admin = $4,
            updated_at = now()
      WHERE provider = $1`,
    [provider, verification.ok, verification.note, updatedByAdmin],
  );
}

export async function deleteCredential(db: Queryable, provider: ProviderId): Promise<void> {
  await db.query('DELETE FROM app_credentials WHERE provider = $1', [provider]);
}

/**
 * Basic shape checks, run before spending a network call.
 *
 * These catch the common paste mistakes — a truncated key, whitespace, the
 * wrong provider's key — with an instant, specific message. They are a
 * convenience, never a substitute for the live check.
 */
export function checkKeyShape(provider: ProviderId, key: string): string | null {
  const trimmed = key.trim();
  if (trimmed === '') return 'Enter a key.';
  if (trimmed !== key) {
    return 'That key has spaces around it. Remove them and try again.';
  }
  if (provider === 'anthropic') {
    if (!trimmed.startsWith('sk-ant-')) {
      return 'An Anthropic key starts with "sk-ant-". Check you pasted the right one.';
    }
    if (trimmed.length < 40) return 'That key looks too short — it may have been cut off.';
  }
  if (provider === 'companies_house' && trimmed.length < 20) {
    return 'That key looks too short — it may have been cut off.';
  }
  return null;
}

/**
 * Decrypt a stored key for server-side use.
 *
 * The only function here that returns plaintext. Callers must use the value to
 * make a request and never place it in a response, a log, or a rendered page.
 * Returns null when nothing is configured, so features can degrade rather than
 * crash.
 */
export async function readCredentialSecret(
  db: Queryable,
  provider: ProviderId,
  masterKey: Buffer,
): Promise<string | null> {
  const result = await db.query<{ ciphertext: string }>(
    'SELECT ciphertext FROM app_credentials WHERE provider = $1',
    [provider],
  );
  const row = result.rows[0];
  if (!row) return null;
  return decryptSecret(row.ciphertext, masterKey);
}
