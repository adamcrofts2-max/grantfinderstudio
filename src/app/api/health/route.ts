import { checkConfiguration, readEnvironment } from '@/env';
import { getDatabase } from '@/db';

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
  } catch {
    database = env.databaseUrl === null ? 'in-memory' : 'unreachable';
  }

  const healthy = problems.length === 0 && database !== 'unreachable';

  return Response.json(
    {
      status: healthy ? 'ok' : 'attention',
      database,
      persistent: env.databaseUrl !== null,
      problems,
    },
    { status: healthy ? 200 : 503 },
  );
}
