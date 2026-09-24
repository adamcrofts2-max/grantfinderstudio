import { claimSecretProblem } from './domain/auth/admin.js';
import { usableBaseUrl } from './domain/auth/reset.js';

/**
 * Environment configuration.
 *
 * Read once, validated loudly. A missing secret should stop the process with a
 * sentence that says how to fix it, not surface later as an unexplained
 * failure in a request.
 */

export interface AppEnvironment {
  /** Postgres connection string. Absent means the in-memory dev database. */
  databaseUrl: string | null;
  /** 32 bytes of base64. Required to store any credential. */
  encryptionKey: string | null;
  /** Overridable for staging or contract tests. */
  companiesHouseBaseUrl: string | null;
  /**
   * The one-time secret that opens the first-admin claim.
   *
   * Absent means the claim never opens, which is the safe default: on a fresh
   * deployment the alternative is racing strangers for your own console.
   */
  adminClaimSecret: string | null;
  /**
   * Where this deployment is reached, e.g. https://app.example.org.
   *
   * Password reset links are built on it. Never on the request's Host header,
   * which is whatever the requester chose to send.
   */
  appUrl: string | null;
  /** Resend, for the password reset email. Absent means no mail is sent. */
  resendApiKey: string | null;
  /** The sender, e.g. "Grant Finder Studio <noreply@example.org>". */
  mailFrom: string | null;
  /** Overridable for a stub in the end-to-end walk. */
  resendBaseUrl: string | null;
  isProduction: boolean;
}

/** A plain record rather than NodeJS.ProcessEnv, which requires NODE_ENV. */
export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export function readEnvironment(
  source: EnvironmentSource = process.env,
): AppEnvironment {
  const value = (name: string): string | null => {
    const raw = source[name];
    return raw === undefined || raw.trim() === '' ? null : raw.trim();
  };

  return {
    databaseUrl: value('DATABASE_URL'),
    encryptionKey: value('APP_ENCRYPTION_KEY'),
    companiesHouseBaseUrl: value('COMPANIES_HOUSE_BASE_URL'),
    adminClaimSecret: value('ADMIN_CLAIM_SECRET'),
    appUrl: value('APP_URL'),
    resendApiKey: value('RESEND_API_KEY'),
    mailFrom: value('MAIL_FROM'),
    resendBaseUrl: value('RESEND_BASE_URL'),
    isProduction: source['NODE_ENV'] === 'production',
  };
}

export interface ConfigProblem {
  variable: string;
  problem: string;
  fix: string;
}

/**
 * Check configuration for a deployment.
 *
 * Returns problems rather than throwing, so a health check can report all of
 * them at once instead of revealing them one restart at a time.
 */
export function checkConfiguration(env: AppEnvironment): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  if (env.isProduction && env.databaseUrl === null) {
    problems.push({
      variable: 'DATABASE_URL',
      problem: 'Not set, so the app would run against an in-memory database that is lost on restart.',
      fix: 'Set it to your Postgres connection string, e.g. postgres://user:pass@host/db?sslmode=require',
    });
  }

  if (env.encryptionKey === null) {
    problems.push({
      variable: 'APP_ENCRYPTION_KEY',
      problem: 'Not set, so API keys cannot be stored.',
      fix: 'Generate one with: openssl rand -base64 32',
    });
  } else {
    let bytes = 0;
    try {
      bytes = Buffer.from(env.encryptionKey, 'base64').length;
    } catch {
      bytes = 0;
    }
    if (bytes !== 32) {
      problems.push({
        variable: 'APP_ENCRYPTION_KEY',
        problem: `Decodes to ${bytes} bytes; 32 are required.`,
        fix: 'Generate a new one with: openssl rand -base64 32',
      });
    }
  }

  const claimProblem = claimSecretProblem(env.adminClaimSecret);
  if (claimProblem !== null) {
    problems.push({
      variable: 'ADMIN_CLAIM_SECRET',
      problem: claimProblem,
      fix: 'Generate one with: openssl rand -base64 32',
    });
  }

  // Mail is optional: without it, password reset says it is not set up. Half
  // of it is a mistake, and one that surfaces only when somebody is locked
  // out — so it is reported here, where the operator is looking.
  const mail = { RESEND_API_KEY: env.resendApiKey, MAIL_FROM: env.mailFrom, APP_URL: env.appUrl };
  if (env.resendApiKey !== null || env.mailFrom !== null) {
    for (const [variable, set] of Object.entries(mail)) {
      if (set === null) {
        problems.push({
          variable,
          problem: 'Not set, so password reset emails cannot be sent although the rest of mail is configured.',
          fix: 'Set RESEND_API_KEY, MAIL_FROM and APP_URL together, or none of them.',
        });
      }
    }
  }
  if (env.appUrl !== null && usableBaseUrl(env.appUrl) === null) {
    problems.push({
      variable: 'APP_URL',
      problem: 'Not an https:// address, so a reset link built on it would carry its token in the clear.',
      fix: 'Set it to the address people use, e.g. https://grants.example.org',
    });
  }

  if (env.databaseUrl !== null && env.isProduction && !/sslmode=|ssl=true/u.test(env.databaseUrl)) {
    problems.push({
      variable: 'DATABASE_URL',
      problem: 'Does not request SSL, so credentials would cross the network in the clear.',
      fix: 'Append ?sslmode=require to the connection string.',
    });
  }

  return problems;
}
