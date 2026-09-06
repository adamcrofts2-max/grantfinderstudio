/**
 * Encryption for stored credentials.
 *
 * API keys are the most sensitive thing this system holds: one leaked
 * Anthropic key is someone else's bill and someone else's data. They are
 * therefore never stored in plaintext, never returned to the browser, and
 * never logged.
 *
 * AES-256-GCM, which authenticates as well as encrypts — a tampered
 * ciphertext fails to decrypt rather than yielding altered plaintext.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Prefix so the format can change later without ambiguity. */
const VERSION = 'v1';

export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretError';
  }
}

/**
 * Derive the master key from configuration.
 *
 * Requires 32 bytes of base64. Deliberately no default and no derivation from
 * a short passphrase: a weak master key silently undermines everything else.
 */
export function loadMasterKey(value: string | undefined): Buffer {
  if (value === undefined || value.trim() === '') {
    throw new SecretError(
      'APP_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32',
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(value, 'base64');
  } catch {
    throw new SecretError('APP_ENCRYPTION_KEY must be valid base64.');
  }
  if (key.length !== KEY_BYTES) {
    throw new SecretError(
      `APP_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Encrypt a secret. Output is safe to store in the database. */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  if (plaintext === '') throw new SecretError('Cannot encrypt an empty secret.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Decrypt a stored secret. Throws if it was tampered with. */
export function decryptSecret(payload: string, masterKey: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretError('Stored secret is not in a recognised format.');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];

  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretError('Stored secret is malformed.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Either the wrong master key or a tampered payload. Do not distinguish:
    // saying which would help an attacker.
    throw new SecretError('Stored secret could not be decrypted.');
  }
}

/**
 * A display form that identifies a key without revealing it.
 *
 * Shows enough for a person to tell two keys apart and no more. Short values
 * are masked entirely rather than partially exposed.
 */
export function maskSecret(plaintext: string): string {
  const trimmed = plaintext.trim();
  if (trimmed.length <= 12) return '••••••••';
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

/** Constant-time comparison, for anything that gates access. */
export function secretsMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
