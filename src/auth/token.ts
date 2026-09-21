/**
 * Session tokens.
 *
 * The token goes to the browser; only its SHA-256 is stored. So a copy of the
 * sessions table is not a set of working credentials — there is nothing in it
 * to replay. This is the same reason a password is not stored in the clear,
 * applied to the thing that stands in for one.
 *
 * SHA-256 rather than a KDF is right here and wrong for passwords: the token
 * is 32 bytes of CSPRNG output, so there is no low-entropy space to grind
 * through, and the lookup is on the hot path of every request.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits. Not guessable, and short enough for a cookie. */
const TOKEN_BYTES = 32;

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('base64url');
}

/** Constant-time comparison, for anywhere two tokens are compared directly. */
export function tokensMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * A review-share token, and its hash.
 *
 * The same construction as a session token, named separately so a call site
 * reads correctly: a share is not a session, it is an opaque bearer token
 * handed to somebody outside the organisation. The security properties it
 * needs are identical — 32 bytes of CSPRNG output, only the SHA-256 stored —
 * so sharing the implementation is the honest option, and aliasing it rather
 * than copying it means there is one thing to get right.
 */
export const createShareToken = createSessionToken;
export const hashShareToken = hashSessionToken;
