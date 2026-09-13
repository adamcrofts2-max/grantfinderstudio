import { withAdmin } from '@/db';
import { readEffectiveSettings } from '@/settings/store';
import {
  THREESIXTYGIVING_BASE_URL_KEY,
  THREESIXTYGIVING_SEARCH_PATH_KEY,
} from '@/settings/registry';
import {
  IngestionError,
  ThreeSixtyGivingConnector,
  type CorpusGrant,
} from '@/ingestion/threesixtygiving/connector';
import { FetchJsonClient } from '@/ingestion/threesixtygiving/http';
import { normaliseGrant } from '@/ingestion/threesixtygiving/normalise';
import { searchPattern } from '@/domain/grants/query';

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
  /** The licence THIS publisher chose, so attribution is data, not a claim. */
  licenceName: string | null;
  licence: string | null;
}

export type CorpusSearch =
  | { state: 'idle' }
  | {
      state: 'ok';
      grants: FoundGrant[];
      total: number | null;
    }
  | { state: 'failed'; message: string };

function toFound(entry: CorpusGrant): FoundGrant | null {
  // Through the same normaliser the ingest uses, so a search result and a
  // stored award are read by one set of rules — including the refusals. A
  // grant in a foreign currency or with no date is dropped here exactly as it
  // would be on the way into the database, rather than rendering as £0.
  const result = normaliseGrant(entry.raw);
  if (!result.ok) return null;
  const award = result.award;
  return {
    id: award.id,
    funderId: entry.funderId,
    funderName: entry.funderName,
    recipientName: award.recipientName,
    title: award.title,
    description: award.description,
    amountGbp: award.amountGbp,
    awardedOn: award.awardedOn,
    region: award.region,
    tags: award.tags,
    licenceName: entry.licenceName,
    licence: entry.licence,
  };
}

/**
 * Search every grant 360Giving holds, live.
 *
 * ## Why this is not a database query
 *
 * The product used to search a local table that an operator filled in one
 * funder at a time, through an eight-field form. So an applicant who wanted to
 * look at grants was shown "no grants have been loaded yet" — the honest
 * report of a design that had put an administrator between a person and public
 * data. There are over two hundred publishers and more than a million grants;
 * curating them by hand is not a smaller version of this, it is a different
 * product.
 *
 * The Data Store's own search covers the whole corpus, so the applicant asks
 * it directly. Nothing is stored: results are shown with their attribution and
 * a link to the funder, which is both the honest posture and the one that stays
 * clear of the database right — a page fetched for the person who asked rather
 * than a copy of somebody's dataset.
 *
 * The local `funder_awards` table keeps its job: a median and an interquartile
 * range need every grant a funder ever made, which is a batch pull rather than
 * something to do while somebody waits. That is what the console ingest is
 * for, and it is now an enrichment step rather than the only door.
 *
 * Fails SOFT and says why. A search that cannot reach the API must not take
 * the page with it — the rest of the screen still works, and an applicant is
 * told whether the problem is their query or ours.
 */
export async function searchCorpus(text: string): Promise<CorpusSearch> {
  const pattern = searchPattern(text);
  if (pattern === null) return { state: 'idle' };

  try {
    const settings = await withAdmin((tx) => readEffectiveSettings(tx));
    const value = (key: string): string =>
      settings.find((s) => s.definition.key === key)?.value ?? '';

    const connector = new ThreeSixtyGivingConnector(new FetchJsonClient(), {
      baseUrl: value(THREESIXTYGIVING_BASE_URL_KEY),
      searchPath: value(THREESIXTYGIVING_SEARCH_PATH_KEY),
    });

    const { grants, total } = await connector.searchGrants(pattern);
    return {
      state: 'ok',
      grants: grants.map(toFound).filter((g): g is FoundGrant => g !== null),
      total,
    };
  } catch (error) {
    console.error('[grantfinderstudio] grant search failed:', error);
    return {
      state: 'failed',
      message:
        error instanceof IngestionError
          ? error.message
          : 'We could not reach 360Giving just now. That is our end, not your search — try again in a moment.',
    };
  }
}
