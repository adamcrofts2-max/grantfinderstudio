import { withAdmin } from '@/db';
import { readEnvironment } from '@/env';
import {
  corpusBytes,
  corpusStanding,
  loadFraction,
  readCorpusProgress,
} from '@/db/corpus';

export const dynamic = 'force-dynamic';

/**
 * How much of the grant corpus has arrived.
 *
 * Open, because none of it is secret and all of it explains an empty search:
 * how many funders have been read, how many grants written, how many skipped
 * for stating no licence, how many grants fell outside the three-year window,
 * and when it last moved. The step that DOES the work lives at
 * `/api/corpus/step`, which needs no secret — the database lease is what stops
 * it being poked.
 */
export async function GET(): Promise<Response> {
  const env = readEnvironment();
  if (env.databaseUrl === null) {
    return Response.json({ ok: false, error: 'No database is configured.' }, { status: 503 });
  }
  try {
    const { progress, bytes } = await withAdmin(async (tx) => ({
      progress: await readCorpusProgress(tx),
      bytes: await corpusBytes(tx),
    }));
    const standing = corpusStanding(progress, new Date());
    return Response.json({
      ok: true,
      loading: standing === 'filling',
      // The four-state answer, because "loading: false" covers a record that
      // has finished, one that never started and one that has stopped dead,
      // and the e2e and the operator both need to tell them apart.
      standing,
      fraction: loadFraction(progress),
      // Including indexes, so it answers the question it is here for: which
      // database tier does holding this record actually need.
      bytes,
      megabytes: bytes === null ? null : Math.round((bytes / 1_048_576) * 10) / 10,
      progress,
    });
  } catch (error) {
    /**
     * Say WHICH thing went wrong.
     *
     * This returned a flat "Progress could not be read." — which is what it
     * says when the database is simply not there, and is useless to whoever
     * pastes it. This endpoint exists to be read by a person diagnosing a
     * deployment, so it has to distinguish "no database" from "the database
     * answered and something else broke". `/api/health` already does; there
     * was no reason for this not to.
     */
    const message = error instanceof Error ? error.message : String(error);
    const unreachable = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|terminat|connect/iu.test(message);
    console.error('[grantfinderstudio] corpus progress could not be read:', error);
    return Response.json(
      {
        ok: false,
        error: unreachable
          ? 'The database could not be reached, so there is no progress to report. See /api/health.'
          : 'The database answered but the progress could not be read. See the server log.',
      },
      { status: 503 },
    );
  }
}
