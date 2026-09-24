/**
 * Password reset: how long a link lasts, and what one looks like.
 *
 * Pure. The link is built here from a configured base address and never from
 * the request, because the request's Host header is whatever the requester
 * sent: build a reset link from it and anyone can ask for YOUR reset email to
 * point at THEIR server, then wait for you to click it.
 *
 * The token goes in the fragment (`#token=…`), not the query string. Browsers
 * never send a fragment to the server, so it is not in any access log, and
 * never in a Referer header, so nothing the page loads can learn it.
 */

export const RESET = {
  /**
   * Thirty minutes. Long enough to find the email, switch devices and come
   * back; short enough that a link found later in somebody's inbox is dead.
   */
  minutes: 30,
} as const;

export function resetExpiry(now: Date): Date {
  return new Date(now.getTime() + RESET.minutes * 60 * 1000);
}

/**
 * Is this a base address a reset link may be built on?
 *
 * HTTPS, or plain HTTP only to this machine for development. A link sent over
 * plain HTTP to a real host would carry the token across the network in the
 * clear the moment it was clicked.
 */
export function usableBaseUrl(raw: string | null): URL | null {
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'https:') return url;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  return url.protocol === 'http:' && local ? url : null;
}

/** The link that goes in the email. */
export function resetLink(base: URL, token: string): string {
  const link = new URL('/reset-password', base);
  link.hash = `token=${token}`;
  return link.toString();
}

/**
 * The token, read back out of a fragment.
 *
 * Only the characters a token is made of (base64url), and only at the length
 * one has, so whatever else somebody pastes after the `#` is never sent on.
 */
export function tokenFromFragment(fragment: string): string | null {
  const match = /^#?token=([A-Za-z0-9_-]{43})$/u.exec(fragment.trim());
  return match?.[1] ?? null;
}

/** The email itself, as plain text. No HTML: nothing to render wrongly, nothing to track. */
export function resetEmail(link: string): { subject: string; text: string } {
  return {
    subject: 'Reset your Grant Finder Studio password',
    text: [
      'Somebody — hopefully you — asked to reset the password for this address on Grant Finder Studio.',
      '',
      'To choose a new password, open this link:',
      '',
      link,
      '',
      `It works once, for ${RESET.minutes} minutes. Choosing a new password signs you out everywhere else.`,
      '',
      'If it was not you, ignore this email. Your password has not changed, and nobody can change it without this link.',
    ].join('\n'),
  };
}
