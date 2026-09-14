import { withAdmin } from '@/db';
import { corpusSize, recentAwards, searchAwards, type AwardResult } from '@/db/grants';
import { readCorpusProgress, isLoading, loadFraction, type CorpusProgress } from '@/db/corpus';
import { queryTerms } from '@/domain/grants/query';

export interface FoundGrant {
  id: string;
  funderId: string | null;
  funderName: string | null;
  recipientName: string | null;
  title: string | null;
  description: string | null;
  amountGbp: number;
  awardedOn: string;
  region: string | null;
  tags: readonly string[];
  /** The licence line that must travel with anything derived from the source. */
  attribution: string | null;
}

export interface CorpusState {
  awards: number;
  funders: number;
  loading: boolean;
  fraction: number | null;
  progress: CorpusProgress;
}

export type CorpusSearch =
  | { state: 'idle'; corpus: CorpusState; recent: FoundGrant[] }
  | {
      state: 'ok';
      grants: FoundGrant[];
      capped: boolean;
      corpus: CorpusState;
    }
  | { state: 'failed'; message: string };

function toFound(award: AwardResult): FoundGrant | null {
  // An award with no date cannot be ranked or shown honestly, and the
  // normaliser should already have refused it on the way in. Dropped here too,
  // because a row written before that rule existed would otherwise render as a
  // grant awarded on no day at all.
  if (award.awardedOn === null) return null;
  return {
    id: award.id,
    funderId: award.funderId,
    funderName: award.funderName,
    recipientName: award.recipientName,
    title: award.title,
    description: award.description,
    amountGbp: award.amountGbp,
    awardedOn: award.awardedOn,
    region: award.region,
    tags: award.tags,
    attribution: award.attribution,
  };
}

const found = (awards: readonly AwardResult[]): FoundGrant[] =>
  awards.map(toFound).filter((g): g is FoundGrant => g !== null);

/**
 * Search the grants this deployment holds.
 *
 * ## Why this is a database query again
 *
 * It was a live call to 360Giving, on the strength of an all-grants search
 * route read out of their source. That route is not public — three deployments
 * proved it, each with a 404 — and their published API has no text search on
 * anything: the organisation lists declare no filter backends, and the grant
 * routes take an id. So grant text can only be searched in a copy we hold,
 * which is also what 360Giving tell developers to do with their data.
 *
 * The complaint that moved the search away from here was right and still
 * stands: an applicant was being shown "no grants have been loaded yet"
 * because an operator had to add funders one at a time through an eight-field
 * form. The answer is that the corpus fills ITSELF, from the funder list — see
 * `ingestion/threesixtygiving/corpus.ts`. An empty search now reports how much
 * of the corpus has arrived, not whose job it was.
 *
 * Fails SOFT and says why. A search that cannot run must not take the page
 * with it.
 */
export async function searchCorpus(text: string): Promise<CorpusSearch> {
  const terms = queryTerms(text);

  try {
    // One connection for the whole thing. `funder_awards`, `funders` and
    // `corpus_load` are shared reference data — every tenant may read all of
    // it, none may write any of it — so there is nothing organisation-specific
    // here to scope or to leak.
    const state = await withAdmin(async (tx) => {
      const size = await corpusSize(tx);
      const progress = await readCorpusProgress(tx);
      return {
        awards: size.awards,
        funders: size.funders,
        loading: isLoading(progress),
        fraction: loadFraction(progress),
        progress,
      };
    });

    if (terms.length === 0) {
      // Nothing typed. Show what has arrived most recently rather than an
      // empty screen — it is the cheapest way to prove the corpus is real.
      const recent = await withAdmin((tx) => recentAwards(tx, 24));
      return { state: 'idle', corpus: state, recent: found(recent) };
    }

    const { awards, capped } = await withAdmin((tx) => searchAwards(tx, terms));
    return { state: 'ok', grants: found(awards), capped, corpus: state };
  } catch (error) {
    console.error('[grantfinderstudio] grant search failed:', error);
    return {
      state: 'failed',
      message:
        'We could not search the grants just now. That is our end, not your search — try again in a moment.',
    };
  }
}
