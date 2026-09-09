import { checkConfiguration, readEnvironment } from '@/env';
import { getDatabase, withAdmin } from '@/db';
import { checkIsolation } from '@/db/isolation';
import { diagnose } from '@/db/diagnose';
import { MIGRATIONS } from '@/db/migrate';

export const dynamic = 'force-dynamic';

/**
 * Health and configuration check.
 *
 * Reports every configuration problem at once rather than revealing them one
 * restart at a time, and confirms the database actually answers. Deliberately
 * returns no secret and no connection string.
 */
export async function GET(): Promise<Response> {
  const env = readEnvironment();
  const problems = checkConfiguration(env);

  let database: 'ok' | 'unreachable' | 'in-memory' = env.databaseUrl === null
    ? 'in-memory'
    : 'unreachable';

  try {
    const db = await getDatabase();
    await db.withTenant('__healthcheck__', async (tx) => {
      await tx.query('SELECT 1');
    });
    if (env.databaseUrl !== null) database = 'ok';
  } catch (error) {
    database = env.databaseUrl === null ? 'in-memory' : 'unreachable';
    if (env.databaseUrl !== null) {
      // The driver's own words, and the fix when we recognise the failure.
      // Safe to show: these describe what went wrong, never the credentials.
      const { detail, hint } = diagnose(error);
      problems.push({
        variable: 'DATABASE_URL',
        problem: detail,
        fix: hint ?? 'Check the connection string, then redeploy.',
      });
    }
  }

  // Checked on every call rather than once at deploy: a privilege granted by
  // hand later would otherwise turn every tenant policy off without changing
  // anything anyone would notice.
  let isolation: 'enforced' | 'NOT ENFORCED' | 'unknown' = 'unknown';
  if (database === 'ok') {
    try {
      const report = await checkIsolation();
      isolation = report.enforced ? 'enforced' : 'NOT ENFORCED';
      problems.push(
        ...report.problems.map((problem) => ({
          variable: 'app_user',
          problem,
          fix: 'Tenant isolation is not in force until this is resolved.',
        })),
      );
    } catch {
      isolation = 'unknown';
    }
  }

  /**
   * Which migrations have actually run.
   *
   * The thing you most want to know right after a deploy that carries a schema
   * change, and the thing nothing reported. Migrations apply themselves on the
   * first request that touches data, so "deployed" and "migrated" are not the
   * same event — and a deploy that cannot migrate fails in a way that looks
   * like an unrelated bug in whatever page you happened to open.
   */
  let migrations: { applied: number; expected: number; pending: string[] } | null = null;
  if (database === 'ok' || database === 'in-memory') {
    try {
      const applied = await withAdmin(async (tx) => {
        const { rows } = await tx.query<{ name: string }>('SELECT name FROM schema_migrations');
        return new Set(rows.map((row) => row.name));
      });
      const pending = MIGRATIONS.filter((name) => !applied.has(name));
      migrations = { applied: applied.size, expected: MIGRATIONS.length, pending: [...pending] };
      for (const name of pending) {
        problems.push({
          variable: 'schema_migrations',
          problem: `${name} has not been applied.`,
          fix: 'It runs on the first request that touches data. If it stays pending, the database user cannot apply it — check the logs.',
        });
      }
    } catch {
      // No table yet is the normal state before the first request. Not a
      // problem to report, because the next request will create it.
      migrations = null;
    }
  }

  const healthy = problems.length === 0 && database !== 'unreachable';

  return Response.json(
    {
      status: healthy ? 'ok' : 'attention',
      database,
      isolation,
      migrations,
      persistent: env.databaseUrl !== null,
      problems,
    },
    { status: healthy ? 200 : 503 },
  );
}
