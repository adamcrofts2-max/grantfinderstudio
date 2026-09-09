/**
 * A dry run against 360Giving: one page, nothing written.
 *
 * The first real ingest on a new deployment is otherwise a leap: type an
 * organisation id and a licence, press the button, and if it fails you cannot
 * tell whether it was the id, the network, the publisher, or a bug in us.
 * This separates them. It fetches a single page and reports what came back,
 * so the id can be checked and the wire proved before anything is stored.
 *
 * Writes nothing, needs no licence, and can be run as many times as you like —
 * which is the point of having it.
 */

import { assertSameOrigin, IngestionError, type HttpClient } from './connector.js';
import { normaliseGrants } from './normalise.js';
import type { RawGrant, RawPage } from './types.js';

export interface ProbeResult {
  /** What the publisher says they have in total, when they say. */
  totalReported: number | null;
  /** Grants on the first page that we could read. */
  usableOnFirstPage: number;
  rejectedOnFirstPage: number;
  rejectionReasons: string[];
  /** More pages after this one. */
  hasMore: boolean;
  /** One readable award, so the operator can see they have the right funder. */
  sample: { amountGbp: number; awardedOn: string; recipientName: string | null } | null;
}

export async function probeFunder(
  http: HttpClient,
  orgId: string,
  baseUrl: string,
): Promise<ProbeResult> {
  const trimmed = orgId.trim();
  if (trimmed === '') throw new IngestionError('A 360Giving organisation id is required.');

  const url = new URL(
    `org/${encodeURIComponent(trimmed)}/grants_made/`,
    baseUrl,
  ).toString();

  const payload: unknown = await http.getJson(url);
  if (typeof payload !== 'object' || payload === null) {
    throw new IngestionError('The API response was not an object.');
  }
  const page = payload as RawPage;
  if (!Array.isArray(page.results)) {
    throw new IngestionError(
      'The API answered, but with no results array. Check the organisation id: a publisher we do not know usually looks like this.',
    );
  }

  const { awards, rejected } = normaliseGrants(page.results as RawGrant[]);
  const first = awards[0];

  // The `next` link is checked against the configured origin even though we
  // are not going to follow it: reporting "there are more pages" on the
  // strength of a link pointing somewhere else would be reporting a fact
  // about somebody else's server.
  let hasMore = false;
  if (typeof page.next === 'string' && page.next !== '') {
    assertSameOrigin(page.next, baseUrl);
    hasMore = true;
  }

  return {
    totalReported: typeof page.count === 'number' ? page.count : null,
    usableOnFirstPage: awards.length,
    rejectedOnFirstPage: rejected.length,
    rejectionReasons: [...new Set(rejected.map((r) => r.reason))].toSorted(),
    hasMore,
    sample:
      first === undefined
        ? null
        : {
            amountGbp: first.amountGbp,
            awardedOn: first.awardedOn,
            recipientName: first.recipientName,
          },
  };
}
