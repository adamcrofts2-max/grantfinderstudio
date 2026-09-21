'use server';

import { revalidatePath } from 'next/cache';

import { withAdmin } from '@/db';
import { startCorpusLoad } from '@/db/corpus';
import { readEffectiveSettings } from '@/settings/store';
import { THREESIXTYGIVING_BASE_URL_KEY } from '@/settings/registry';
import { advanceCorpus } from '@/ingestion/threesixtygiving/corpus';
import { FetchJsonClient } from '@/ingestion/threesixtygiving/http';

import { requireAdmin } from '../session';
import { EMPTY_CORPUS, type CorpusActionState } from './corpus-state';

/**
 * Begin assembling the grant corpus.
 *
 * Deliberately does not delete anything. A restart re-walks 360Giving's funder
 * list and replaces each funder's awards as it reaches them, so the corpus
 * stays searchable all the way through rather than emptying for an hour while
 * it refills.
 */
export async function startCorpusAction(): Promise<CorpusActionState> {
  await requireAdmin();
  try {
    await withAdmin((tx) => startCorpusLoad(tx));
  } catch (error) {
    console.error('[grantfinderstudio] could not start the corpus load:', error);
    return { ...EMPTY_CORPUS, message: 'The load could not be started.', at: Date.now() };
  }
  // The console, which is the page this action returns to. NOT `/grants`:
  // see the note on `stepCorpusAction`.
  revalidatePath('/admin/funders');
  return {
    ok: true,
    message:
      'Started from the top of 360Giving’s funder list. Nothing already loaded has been removed — each funder is replaced as the walk reaches them.',
    at: Date.now(),
  };
}

/**
 * Run one step by hand.
 *
 * The scheduler is what normally advances the load, and this exists because a
 * scheduled job you cannot trigger is a job you cannot debug: pressing it once
 * proves the credentials, the licence rule and the write path all work before
 * anybody waits an hour to find out they do not.
 */
export async function stepCorpusAction(): Promise<CorpusActionState> {
  await requireAdmin();
  try {
    const settings = await withAdmin((tx) => readEffectiveSettings(tx));
    const baseUrl =
      settings.find((s) => s.definition.key === THREESIXTYGIVING_BASE_URL_KEY)?.value ?? '';

    const result = await advanceCorpus(new FetchJsonClient(), (fn) => withAdmin(fn), { baseUrl });
    /**
     * The console only.
     *
     * `revalidatePath('/grants')` was here too, and it could not help: the
     * applicant's search is `force-dynamic`, so it is never cached and the
     * next request renders the new grants whatever this says. What it could
     * do is harm. Revalidating a path invalidates the CLIENT router cache for
     * anybody holding that page, and this action runs in bursts — a step
     * chains the next one — while applicants are loading `/grants`. A client
     * that re-fetches the payload for a page it is in the middle of
     * hydrating reconciles HTML rendered at one moment of a load against a
     * payload rendered at another, which is React #418 and a discarded tree.
     *
     * That error appeared in the e2e about one run in two, always inside a
     * corpus load, and three attempts to reproduce it with the corpus being
     * written by other means never saw it — the runs that produce it are
     * exactly the ones where this action fires. `grants-dynamic.test.ts`
     * holds the premise: if `/grants` ever stops being force-dynamic, the
     * revalidation has to come back and this reasoning has to be redone.
     */
    revalidatePath('/admin/funders');

    const parts = [
      `${result.walked} funder${result.walked === 1 ? '' : 's'} read`,
      `${result.awardsWritten} grant${result.awardsWritten === 1 ? '' : 's'} written`,
    ];
    if (result.unlicensed > 0) {
      parts.push(`${result.unlicensed} skipped for stating no licence`);
    }
    if (result.finished) parts.push('the list is finished');

    return {
      ok: result.error === null,
      message: `${parts.join(', ')}.${result.error === null ? '' : ` One publisher could not be read — ${result.error}`}`,
      at: Date.now(),
    };
  } catch (error) {
    console.error('[grantfinderstudio] corpus step failed:', error);
    return {
      ...EMPTY_CORPUS,
      message:
        error instanceof Error
          ? `The step failed: ${error.message}`
          : 'The step failed. Nothing partial has been left behind.',
      at: Date.now(),
    };
  }
}
