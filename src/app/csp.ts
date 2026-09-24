/**
 * The Content-Security-Policy, as one pure function.
 *
 * ## What it buys
 *
 * Until now the only policy was `frame-ancestors 'none'`. That stops framing,
 * and nothing else: an injected `<script>` — through a funder name, a pasted
 * page, a reviewer's comment, any path the escaping one day misses — would
 * run with the full authority of a signed-in session. This policy makes the
 * browser refuse every script it was not told about.
 *
 * ## How
 *
 * A fresh random nonce per request (middleware), and scripts allowed ONLY by
 * that nonce. Next stamps it on its own hydration scripts when it finds it in
 * the request's policy header — which requires the page to be rendered per
 * request, and every page here is (the root layout reads headers). A script
 * that arrived by injection cannot know this request's nonce.
 *
 * `'strict-dynamic'` lets a nonced script load the chunks it needs, and makes
 * modern browsers ignore host allow-lists, so there is no list to get wrong.
 *
 * ## What it deliberately allows
 *
 * Inline STYLES. The product sets `style={…}` attributes throughout, and a
 * style cannot run code; `'unsafe-inline'` on `style-src` is the accepted
 * trade. Not `'unsafe-eval'` — except in development, where React's dev
 * build needs it and nobody's data is at stake.
 *
 * Pure and edge-safe: middleware runs on the edge runtime.
 */

export function contentSecurityPolicy(nonce: string, { development = false } = {}): string {
  const script = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (development) script.push(`'unsafe-eval'`);
  return [
    `default-src 'self'`,
    `script-src ${script.join(' ')}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    // Forms post only here. A page that injected a form could otherwise send
    // somebody's typing to any address it liked.
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
}

/** A nonce: 128 random bits, base64. Web Crypto, so it works on the edge. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
