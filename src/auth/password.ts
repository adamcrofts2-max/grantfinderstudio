/**
 * Password hashing.
 *
 * scrypt from Node's own crypto, not a dependency. It is a memory-hard KDF in
 * the standard library, which means one fewer supply-chain surface on the one
 * path where a compromise is worst, and no native build to go wrong on a
 * deploy.
 *
 * The stored form carries its own parameters, so the cost can be raised later
 * without invalidating everyone's password: an old hash still verifies against
 * the parameters it was made with, and is rewritten at the next successful
 * sign-in.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SCRYPT = {
  /** 2^16. About 64 MB and ~100ms on ordinary hardware — expensive to attack, tolerable to sign in. */
  N: 65536,
  r: 8,
  p: 1,
  keyLength: 64,
  saltLength: 16,
} as const;

/** Node's default maxmem (32 MB) is below what these parameters need. */
const MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

const PREFIX = 'scrypt';

/** `scrypt$N$r$p$salt$hash`, base64url throughout. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltLength);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: MAXMEM,
  });
  return [
    PREFIX,
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/**
 * Check a password against a stored hash.
 *
 * Never throws on a malformed hash — it returns false. A row corrupted in the
 * database must lock that account out, not crash the sign-in route for
 * everybody, and must not distinguish itself from a wrong password.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const [prefix, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (prefix !== PREFIX) return false;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // A hostile row could otherwise name parameters that exhaust the machine.
  if (N < 1024 || N > 1 << 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  const salt = Buffer.from(rawSalt ?? '', 'base64url');
  const expected = Buffer.from(rawHash ?? '', 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
  } catch {
    return false;
  }
  // Lengths already match by construction; timingSafeEqual still requires it.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Should this hash be replaced next time we hold the plaintext? */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return true;
  return Number(parts[1]) < SCRYPT.N || Number(parts[2]) < SCRYPT.r || Number(parts[3]) < SCRYPT.p;
}
