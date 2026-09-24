/**
 * Sending email. One message exists — the password reset — so this is small
 * on purpose: an interface with two ways to satisfy it, and a function that
 * picks one from the environment.
 *
 *   Resend — over plain `fetch`, no SDK. The API is one POST; a dependency for
 *     it would be more code to audit than the call itself.
 *   The server log — development only. The link is printed where the person
 *     running the app is already looking, so a reset can be walked locally
 *     without an account anywhere.
 *
 * In production with no mail configured there is NO mailer, rather than a
 * silent one: the reset form says it is not set up here, instead of promising
 * an email that will never arrive.
 */

import type { AppEnvironment } from '../env.js';
import { usableBaseUrl } from '../domain/auth/reset.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly kind: 'resend' | 'log';
  send(mail: Mail): Promise<void>;
}

export interface MailSetup {
  mailer: Mailer;
  /** What links in an email are built on. */
  linkBase: URL;
}

const RESEND_API = 'https://api.resend.com';

export function resendMailer(
  apiKey: string,
  from: string,
  baseUrl: string = RESEND_API,
  send: typeof fetch = fetch,
): Mailer {
  return {
    kind: 'resend',
    async send(mail) {
      const response = await send(new URL('/emails', baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // The status and Resend's own words, never the key or the message.
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        throw new Error(`Resend refused the email: ${response.status} ${detail}`);
      }
    },
  };
}

export function logMailer(write: (line: string) => void = console.info): Mailer {
  return {
    kind: 'log',
    async send(mail) {
      write(`[grantfinderstudio] email to ${mail.to} — ${mail.subject}\n${mail.text}`);
    },
  };
}

/** How this deployment sends mail, or null when it cannot. */
export function mailSetup(env: AppEnvironment): MailSetup | null {
  const linkBase = usableBaseUrl(env.appUrl);
  if (env.resendApiKey !== null && env.mailFrom !== null && linkBase !== null) {
    return {
      mailer: resendMailer(env.resendApiKey, env.mailFrom, env.resendBaseUrl ?? RESEND_API),
      linkBase,
    };
  }
  if (!env.isProduction) {
    return { mailer: logMailer(), linkBase: linkBase ?? new URL('http://localhost:3000') };
  }
  return null;
}
