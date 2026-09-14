import { withAdmin } from '@/db';
import { readEnvironment } from '@/env';
import { readEffectiveSettings } from '@/settings/store';
import { THREESIXTYGIVING_BASE_URL_KEY } from '@/settings/registry';
import { advanceCorpus } from '@/ingestion/threesixtygiving/corpus';
import { FetchJsonClient } from '@/ingestion/threesixtygiving/http';

export const dynamic = 'force-dynamic';
/**
 * Long for a request, short for a load.
 *
 * The step bounds itself at 210s; this is the ceiling it runs inside. 300 is
 * the most Vercel allow on the plans this runs on, and asking for it means one
 * publisher with fifty pages of history at two requests a second does not take
 * the whole step down with it.
 */
export const maxDuration = 300;

/**
 * Advance the grant corpus by one step.
 *
 * ## Why this is a GET
 *
 * Because Vercel's scheduler issues a GET, with `Authorization: Bearer
 * $CRON_SECRET`. Writing it as a POST, which is what a route that writes ought
 * to be, would have produced a cron that 405s every ten minutes and a corpus
 * that never loads — a fault nothing but the real scheduler would have shown.
 * Guarded by a secret that only the scheduler and an operator hold, so it is
 * not a URL anybody can pull to make this deployment hammer somebody else's
 * API.
 *
 * ## Why there is no unauthenticated fallback
 *
 * With no secret configured it refuses everything. An endpoint that defaults
 * to open, fetches from a charity's API on demand and writes to the database is
 * a way to get this deployment blocked; the honest failure is a closed door
 * that says which variable is missing.
 */
function authorised(request: Request): boolean {
  // CRON_SECRET is Vercel's own convention and what their scheduler sends.
  // CORPUS_LOAD_SECRET lets an operator drive the same route by hand, or a
  // scheduler somewhere else drive it, without sharing the platform's secret.
  const accepted = [process.env['CRON_SECRET'] ?? '', process.env['CORPUS_LOAD_SECRET'] ?? '']
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (accepted.length === 0) return false;

  const offered =
    request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '').trim() ??
    request.headers.get('x-corpus-secret')?.trim() ??
    '';
  if (offered === '') return false;

  return accepted.some((expected) => constantTimeEqual(expected, offered));
}

/** Same length or not, no early exit on a differing byte. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let differences = 0;
  for (let i = 0; i < left.length; i += 1) differences |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return differences === 0;
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json(
      {
        ok: false,
        error:
          'Neither CRON_SECRET nor CORPUS_LOAD_SECRET is set, or the secret offered did not match. The corpus load is not open to unauthenticated callers.',
      },
      { status: 401 },
    );
  }

  const env = readEnvironment();
  if (env.databaseUrl === null) {
    return Response.json(
      { ok: false, error: 'No database is configured, so there is nowhere to load into.' },
      { status: 503 },
    );
  }

  try {
    const settings = await withAdmin((tx) => readEffectiveSettings(tx));
    const baseUrl =
      settings.find((s) => s.definition.key === THREESIXTYGIVING_BASE_URL_KEY)?.value ?? '';

    const result = await advanceCorpus(new FetchJsonClient(), (fn) => withAdmin(fn), { baseUrl });

    return Response.json({
      ok: true,
      walked: result.walked,
      awardsWritten: result.awardsWritten,
      unlicensed: result.unlicensed,
      finished: result.finished,
      // Reported, not thrown: a step that skipped one bad publisher still did
      // its work, and the scheduler needs to call again either way.
      error: result.error,
      progress: result.progress,
    });
  } catch (error) {
    console.error('[grantfinderstudio] corpus step failed:', error);
    return Response.json(
      { ok: false, error: 'The corpus step failed. Nothing partial has been left behind.' },
      { status: 500 },
    );
  }
}
