/**
 * Turning a database connection failure into something actionable.
 *
 * A deployment that cannot reach its database is the single most likely thing
 * to go wrong on a first deploy, and "unreachable" on its own sends an
 * operator hunting. Postgres and Node both say precisely what went wrong; this
 * translates that into the fix.
 *
 * The message and code are safe to show an operator: driver errors describe
 * the failure, never the credentials. The connection string is never included.
 */

export interface Diagnosis {
  /** The driver's own words. */
  detail: string;
  /** What to do about it, when the failure is one we recognise. */
  hint: string | null;
}

interface DriverError {
  message?: unknown;
  code?: unknown;
  name?: unknown;
}

const HINTS: ReadonlyArray<{ match: RegExp; hint: string }> = [
  {
    match: /channel binding|SASL|SCRAM/iu,
    hint: 'Remove "&channel_binding=require" from the end of DATABASE_URL and redeploy.',
  },
  {
    match: /password authentication failed|28P01/u,
    hint: 'The password in DATABASE_URL is wrong. Reset the role password in your database provider and paste the new connection string in.',
  },
  {
    match: /ENOTFOUND|EAI_AGAIN|getaddrinfo/u,
    hint: 'The hostname in DATABASE_URL cannot be resolved. Check it was pasted whole, with no line break in the middle.',
  },
  {
    match: /ETIMEDOUT|timeout expired|Connection terminated due to connection timeout/iu,
    hint: 'The database did not answer in time. If it sleeps when idle, open it once in your provider’s console and try again.',
  },
  {
    match: /ECONNREFUSED/u,
    hint: 'Nothing is listening at that host and port. Check the host in DATABASE_URL, and that you used the pooled connection string.',
  },
  {
    match: /does not exist|3D000/u,
    hint: 'That database name does not exist on the server named in DATABASE_URL.',
  },
  {
    match: /permission denied to create role|42501/u,
    hint: 'The database user cannot create roles. Run "CREATE ROLE app_user NOLOGIN;" once in your provider’s SQL editor, then redeploy.',
  },
  {
    match: /self.signed|certificate|SSL|TLS/iu,
    hint: 'The TLS handshake failed. Check DATABASE_URL ends with "?sslmode=require".',
  },
  {
    match: /no pg_hba\.conf entry/iu,
    hint: 'The server refused the connection’s origin or SSL mode. Check DATABASE_URL ends with "?sslmode=require".',
  },
];

/**
 * Strip credentials out of anything that looks like a connection string.
 *
 * Driver errors describe the failure rather than the credentials, so this
 * should never have anything to do — but `/api/health` needs no authentication
 * and this is the one place a driver message reaches it. Belt and braces on
 * the path where being wrong is worst.
 */
function redact(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s@/]+@/giu, '$1***@');
}

export function diagnose(error: unknown): Diagnosis {
  const e = (error ?? {}) as DriverError;
  const message = typeof e.message === 'string' ? e.message : String(error);
  const code = typeof e.code === 'string' ? e.code : null;
  const detail = redact(code === null ? message : `${message} (${code})`);

  const found = HINTS.find((h) => h.match.test(detail));
  return { detail, hint: found?.hint ?? null };
}
