'use server';

import { revalidatePath } from 'next/cache';

import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadFacts, saveWebsiteFacts } from '@/db/workspace';
import { isWriterAvailable } from '@/app/drafting';
import { createProvider } from '@/ai/providers/anthropic';
import { extractorFor } from '@/documents/ingest';
import { ingestWebsite } from '@/ingestion/web/ingest';
import { WebFetchError } from '@/ingestion/web/fetch';
import { checkWebAddress } from '@/domain/web/address';

import { EMPTY_READ_WEBSITE, type ReadWebsiteState } from './state';

/**
 * A stable, short key for one page, so re-reading it updates rather than adds.
 *
 * The URL itself cannot be the key — it is far too long for an id column
 * shared with everything else, and it contains characters that would make the
 * id unreadable in a log. A hash of it is stable across reads, which is the
 * only property needed.
 */
async function pageKey(url: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

/**
 * Read the organisation's own website and propose facts from it.
 *
 * The fastest honest route from a blank profile to the five confirmed facts
 * the Writer needs: most CICs have already written who they are, who they
 * serve and where — on their own About page. Typing it again into a form is
 * work nobody should be asked to repeat.
 *
 * Everything it proposes is UNCONFIRMED. That is not a limitation to be
 * relaxed later; it is the whole reason this is safe to point at the open web.
 * A page that talks the extractor into "annual turnover: £2m" produces a row
 * saying £2m with the quote beside it, and a person saying no.
 */
export async function readWebsiteAction(
  _previous: ReadWebsiteState,
  formData: FormData,
): Promise<ReadWebsiteState> {
  const organisationId = await requireOrganisationId();
  const typed = String(formData.get('website') ?? '').trim();

  // Checked here as well as inside the fetcher, so an address that was never
  // going to be read costs nobody a model call or a network round trip.
  const address = checkWebAddress(typed);
  if (!address.ok) {
    return {
      ...EMPTY_READ_WEBSITE,
      message: address.message ?? 'That address cannot be read.',
      value: typed,
    };
  }

  if (!(await isWriterAvailable())) {
    return {
      ...EMPTY_READ_WEBSITE,
      message:
        'Reading a website needs an Anthropic key, which this deployment does not have. You can still add facts by hand below — nothing has been read.',
      value: typed,
    };
  }

  const created = createProvider();
  if (!created.available) {
    return { ...EMPTY_READ_WEBSITE, message: created.reason, value: typed };
  }

  const database = await getDatabase();
  const existingFacts = await database.withTenant(organisationId, (tx) => loadFacts(tx));

  let ingested;
  try {
    // Read OUTSIDE the transaction. Holding one open across a network fetch
    // and a model call would keep a database connection for the length of the
    // slowest thing in the request.
    ingested = await ingestWebsite({ url: address.url ?? typed, existingFacts }, extractorFor(created.provider));
  } catch (error) {
    if (error instanceof WebFetchError) {
      return { ...EMPTY_READ_WEBSITE, message: error.message, value: typed };
    }
    console.error('[grantfinderstudio] could not read a website:', error);
    return {
      ...EMPTY_READ_WEBSITE,
      message: 'We could not read that page. Nothing has been saved — please try again.',
      value: typed,
    };
  }

  const key = await pageKey(ingested.url);
  let stored: number;
  try {
    stored = await database.withTenant(organisationId, (tx) =>
      saveWebsiteFacts(tx, organisationId, key, ingested.url, ingested.results),
    );
  } catch (error) {
    console.error('[grantfinderstudio] could not save what a website said:', error);
    return {
      ...EMPTY_READ_WEBSITE,
      message: 'We read the page but could not save what it said. Please try again.',
      value: typed,
      url: ingested.url,
    };
  }

  revalidatePath('/organisation');
  revalidatePath('/');

  const duplicates = ingested.results.filter((r) => r.kind === 'duplicate').length;
  const message =
    stored === 0
      ? duplicates > 0
        ? 'Nothing new — everything that page says is already here.'
        : 'We read the page but could not find anything about your organisation on it. Try the page that describes what you do.'
      : `${stored} thing${stored === 1 ? '' : 's'} to check, below. Nothing from a website is used in an application until you have said it is right.`;

  return {
    ok: stored > 0,
    message,
    url: ingested.url,
    proposed: stored,
    instructionLike: ingested.instructionLikeContent,
    value: '',
  };
}
