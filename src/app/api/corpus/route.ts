import { withAdmin } from '@/db';
import { readEnvironment } from '@/env';
import { isLoading, loadFraction, readCorpusProgress } from '@/db/corpus';

export const dynamic = 'force-dynamic';

/**
 * How much of the grant corpus has arrived.
 *
 * Open, because none of it is secret and all of it explains an empty search:
 * how many funders have been read, how many grants written, how many skipped
 * for stating no licence, and when it last moved. The step that DOES the work
 * lives at `/api/corpus/step` and needs a secret.
 */
export async function GET(): Promise<Response> {
  const env = readEnvironment();
  if (env.databaseUrl === null) {
    return Response.json({ ok: false, error: 'No database is configured.' }, { status: 503 });
  }
  try {
    const progress = await withAdmin((tx) => readCorpusProgress(tx));
    return Response.json({
      ok: true,
      loading: isLoading(progress),
      fraction: loadFraction(progress),
      progress,
    });
  } catch {
    return Response.json({ ok: false, error: 'Progress could not be read.' }, { status: 500 });
  }
}
