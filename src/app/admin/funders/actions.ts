'use server';

import { revalidatePath } from 'next/cache';

import { withAdmin } from '@/db';
import { deleteFunder } from '@/db/awards';
import { IngestionError } from '@/ingestion/threesixtygiving/connector';
import { FetchJsonClient } from '@/ingestion/threesixtygiving/http';
import { ingestFunder, type IngestRequest } from '@/ingestion/threesixtygiving/ingest';
import { readEffectiveSettings } from '@/settings/store';
import {
  THREESIXTYGIVING_BASE_URL_KEY,
  THREESIXTYGIVING_MAX_PAGES_KEY,
} from '@/settings/registry';
import { JURISDICTIONS, type Jurisdiction } from '@/domain/types';

import { requireAdmin } from '../session';
import { INGEST_FIELDS, type IngestFormState } from './state';
import { NO_VALUES, readValues } from '@/app/formValues';

/**
 * Loading a funder's awarded grants.
 *
 * On the OWNER connection: `funders`, `funder_awards` and `source_datasets`
 * are shared reference data that every tenant reads and no tenant writes, and
 * `app_operator` holds SELECT and nothing more. Raising privilege for the
 * write is a smaller surface than holding it all the time.
 *
 * `requireAdmin` runs first. A server action is a public endpoint — the page
 * rendering behind a guard does not guard the action.
 */
export async function ingestFunderAction(
  _previous: IngestFormState,
  formData: FormData,
): Promise<IngestFormState> {
  await requireAdmin();

  const read = (name: string): string => String(formData.get(name) ?? '').trim();
  const errors: Record<string, string> = {};
  // Echoed back on every failure path below. A rejected form must not cost
  // somebody the eight fields they just typed.
  const values = readValues(formData, INGEST_FIELDS);

  const orgId = read('orgId');
  // GB-CHC-1164883, GB-COH-07654321, 360G-xxxx. Loose on purpose: the register
  // prefixes change, and a rejected valid id is worse than a failed fetch.
  if (orgId === '') errors['orgId'] = 'The 360Giving organisation id, e.g. GB-CHC-1164883.';
  else if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,60}$/u.test(orgId)) {
    errors['orgId'] = 'That does not look like an organisation identifier.';
  }

  const funderName = read('funderName');
  if (funderName === '') errors['funderName'] = 'What should this funder be called?';

  const publisher = read('publisher');
  if (publisher === '') errors['publisher'] = 'Who publishes this data?';

  const licence = read('licence');
  if (licence === '') {
    errors['licence'] = 'Read the publisher’s own terms. This is not ours to guess.';
  }

  const attribution = read('attribution');
  if (attribution === '') {
    errors['attribution'] = 'The credit line their licence requires.';
  }

  const website = read('website');
  if (website !== '' && !/^https?:\/\/\S+\.\S+/u.test(website)) {
    errors['website'] = 'That is not a web address.';
  }

  const jurisdictionRaw = read('jurisdiction');
  const jurisdiction: Jurisdiction | null =
    jurisdictionRaw === '' ? null
    : (JURISDICTIONS as readonly string[]).includes(jurisdictionRaw)
      ? (jurisdictionRaw as Jurisdiction)
      : null;

  if (Object.keys(errors).length > 0) {
    return { ok: false, message: 'Check the highlighted fields.', detail: [], errors, values };
  }

  const request: IngestRequest = {
    orgId,
    funderName,
    website: website === '' ? null : website,
    jurisdiction,
    licence,
    licenceUrl: read('licenceUrl') === '' ? null : read('licenceUrl'),
    attribution,
    publisher,
  };

  try {
    // Base URL and page cap come from the console, so an operator can point at
    // a mirror or raise the cap for a large publisher without a redeploy.
    const settings = await withAdmin((tx) => readEffectiveSettings(tx));
    const value = (key: string): string =>
      settings.find((s) => s.definition.key === key)?.value ?? '';
    const baseUrl = value(THREESIXTYGIVING_BASE_URL_KEY);
    const maxPages = Number(value(THREESIXTYGIVING_MAX_PAGES_KEY));

    // A client per run, so two ingests are two independent 2/second streams
    // rather than one shared limiter.
    const outcome = await ingestFunder(new FetchJsonClient(), request, (fn) => withAdmin(fn), {
      baseUrl,
      maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
    });

    const detail: string[] = [
      `${outcome.awardsWritten} grants written from ${outcome.pagesFetched} page${outcome.pagesFetched === 1 ? '' : 's'}.`,
    ];
    if (outcome.rejected > 0) {
      detail.push(`${outcome.rejected} records could not be used:`);
      detail.push(...outcome.rejectionReasons);
    }
    if (outcome.truncated) {
      detail.push(
        'Stopped at the page limit — this publisher has more. Raise “Pages per ingest” under Services and run it again.',
      );
    }
    if (outcome.awardsWritten === 0) {
      detail.push(
        'No usable grants. Check the organisation id against the publisher’s own 360Giving page before assuming they publish nothing.',
      );
    }

    revalidatePath('/admin/funders');
    revalidatePath('/funders');
    revalidatePath('/admin');
    return {
      ok: true,
      message: `${funderName} — ${outcome.awardsWritten} grants loaded.`,
      detail,
      errors: {},
      // Cleared on success: the form is ready for the next funder.
      values: NO_VALUES,
    };
  } catch (error) {
    console.error('[grantfinderstudio] 360Giving ingest failed:', error);
    return {
      ok: false,
      message:
        error instanceof IngestionError
          ? error.message
          : 'The ingest failed. Nothing has been changed for this funder.',
      detail: [],
      errors: {},
      values,
    };
  }
}

export async function removeFunderAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (id === '') return;
  await withAdmin((tx) => deleteFunder(tx, id));
  revalidatePath('/admin/funders');
  revalidatePath('/funders');
  revalidatePath('/admin');
}
