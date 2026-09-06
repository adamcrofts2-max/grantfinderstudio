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

  if (env.databaseUrl !== null && env.isProduction && !/sslmode=|ssl=true/u.test(env.databaseUrl)) {
    problems.push({
      variable: 'DATABASE_URL',
      problem: 'Does not request SSL, so credentials would cross the network in the clear.',
      fix: 'Append ?sslmode=require to the connection string.',
    });
  }

  return problems;
}
