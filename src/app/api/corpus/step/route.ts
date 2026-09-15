import { readEnvironment } from '@/env';
import {
  nudgeCorpus,
  SCHEDULED_DEADLINE_MS,
  SCHEDULED_MIN_SECONDS,
  VISIT_DEADLINE_MS,
  VISIT_MIN_SECONDS,
} from '@/app/corpus-autostart';

export const dynamic = 'force-dynamic';
/**
 * Long for a request, short for a load.
 *
 * A scheduled step bounds itself at 210s; this is the ceiling it runs inside.
 * 300 is the most Vercel allow on the plans this runs on.
 */
export const maxDuration = 300;

/**
 * Advance the grant corpus by one step.
 *
 * ## Why this is a GET
 *
 * Because Vercel's scheduler issues a GET. Writing it as a POST, which is what
 * a route that writes ought to be, would produce a cron that 405s every day
 * and a record that never fills — a fault nothing but the real scheduler would
 * have shown.
 *
 * ## Why it needs no secret
 *
 * It used to demand one, and refuse everything without it. That was the wrong
 * trade twice over: it made the load require an environment variable before it
 * would run at all — so a fresh deployment sat empty until somebody configured
 * it — and it was protecting the wrong thing anyway. This endpoint fetches
 * PUBLIC data and writes SHARED reference data. Nothing here is anybody's to
 * keep private. The only real cost of being poked is requests to a charity's
 * API and time on this deployment's clock, and a secret is a poor way to bound
 * either.
 *
 * `claimCorpusStep` bounds both properly: a database lease means at most one
 * step per interval for everyone, whoever asks and however often. So an
 * unrecognised caller gets the same short nudge a page visit does, and the
 * scheduler — which announces itself with `x-vercel-cron`, or carries
 * `CRON_SECRET` if one is set — gets the long batch.
 *
 * The header is trivially forgeable, and that is fine: forging it buys a
 * 210-second step instead of a 20-second one, once every 30 seconds at most,
 * doing work this deployment wants done.
 */
function scheduled(request: Request): boolean {
  // Vercel sets this on cron invocations.
  if (request.headers.get('x-vercel-cron') !== null) return true;

  const expected = (process.env['CRON_SECRET'] ?? process.env['CORPUS_LOAD_SECRET'] ?? '').trim();
  if (expected === '') return false;

  const offered =
    request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '').trim() ??
    request.headers.get('x-corpus-secret')?.trim() ??
    '';
  return offered !== '' && constantTimeEqual(expected, offered);
}

/** No early exit on a differing byte. */
function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  let differences = 0;
  for (let i = 0; i < left.length; i += 1) differences |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return differences === 0;
}

/**
 * Ask ourselves for the next step, without waiting for it.
 *
 * ## Why chaining
 *
 * The first real run did 16 funders in four and a half hours — because the
 * only things advancing it were a DAILY cron and whoever happened to open the
 * grant search. At that rate 355 funders is four days, and an applicant who
 * arrives on day one searches a twentieth of the record.
 *
 * A step that has more to do now asks for the next one. A daily cron becomes a
 * continuous walk that stops itself when the list is finished — 355 funders in
 * a couple of hours rather than most of a week.
 *
 * ## Why this cannot run away
 *
 * `claimCorpusStep` is a database lease: at most one step per interval for
 * everybody, however many callers ask. Chaining does not raise the ceiling, it
 * just stops the ceiling going unused. And a chain only happens when the walk
 * is UNFINISHED and the step actually did work, so the last step is the last
 * step.
 *
 * Fire and forget, deliberately: awaiting it would make one request hold open
 * for the length of the entire remaining walk.
 */
function chain(request: Request): void {
  const next = new URL(request.url);
  void fetch(next.toString(), {
    headers: {
      // Carried through so the next step is recognised as the scheduler's and
      // gets the long deadline rather than a visitor's short nudge.
      ...(request.headers.get('x-vercel-cron') === null
        ? {}
        : { 'x-vercel-cron': request.headers.get('x-vercel-cron') as string }),
      ...(request.headers.get('authorization') === null
        ? {}
        : { authorization: request.headers.get('authorization') as string }),
    },
  }).catch(() => {
    // Nothing to do about it here. The cron and the next visitor are both
    // still backstops, and the lease means a lost chain costs one interval.
  });
}

export async function GET(request: Request): Promise<Response> {
  const env = readEnvironment();
  if (env.databaseUrl === null) {
    return Response.json(
      { ok: false, error: 'No database is configured, so there is nowhere to load into.' },
      { status: 503 },
    );
  }

  const batch = scheduled(request);
  const result = await nudgeCorpus(
    batch ? SCHEDULED_DEADLINE_MS : VISIT_DEADLINE_MS,
    batch ? SCHEDULED_MIN_SECONDS : VISIT_MIN_SECONDS,
  );

  // More to do, and we just did some: keep going.
  const chained = result.ran && !result.finished && result.walked > 0;
  if (chained) chain(request);

  return Response.json({
    ok: true,
    // False means somebody else had the lease, or the walk is finished. Not an
    // error: a scheduler calling into a busy minute should do nothing.
    ran: result.ran,
    scheduled: batch,
    chained,
    walked: result.walked,
    awardsWritten: result.awardsWritten,
    truncated: result.truncated,
    finished: result.finished,
    error: result.error,
  });
}
