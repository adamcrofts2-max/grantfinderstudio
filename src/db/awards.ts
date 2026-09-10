/**
 * Writing ingested funders and their awarded grants.
 *
 * The last missing link in the discovery half of the product. The connector,
 * the normaliser, the funder-behaviour summary, the prospect matcher and the
 * `/funders` screen were all finished; nothing wrote a row, so every one of
 * them ran against an empty table and the screen was permanently empty. Only
 * the demo seed had ever inserted an award.
 *
 * OWNER scope. `funders`, `funder_awards` and `source_datasets` are shared
 * reference data: every tenant may read them (0001 grants SELECT to app_user)
 * and no tenant may write them. `app_operator` deliberately has SELECT and
 * nothing more, so ingestion runs on the owner connection — the same rule the
 * shared catalogue follows.
 */

import type { Queryable } from './client.js';
import type { IngestedAward } from '../ingestion/threesixtygiving/normalise.js';
import type { SourceDataset } from '../ingestion/threesixtygiving/types.js';
import type { Jurisdiction } from '../domain/types.js';

/**
 * The id a 360Giving funder is stored under.
 *
 * Derived from their org identifier rather than generated, so re-ingesting the
 * same funder updates the same row instead of creating a second copy that
 * splits their award history in two — which would quietly halve the grant
 * count every behaviour summary is computed from.
 */
export function funderIdFor360Giving(orgId: string): string {
  return `funder_360g_${orgId.trim()}`;
}

/** The dataset row an ingest's provenance hangs off. */
export async function upsertSourceDataset(
  tx: Queryable,
  dataset: SourceDataset,
): Promise<void> {
  await tx.query(
    `INSERT INTO source_datasets
       (id, name, publisher, licence, licence_url, attribution, retrieved_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, publisher = EXCLUDED.publisher,
       licence = EXCLUDED.licence, licence_url = EXCLUDED.licence_url,
       attribution = EXCLUDED.attribution, retrieved_at = EXCLUDED.retrieved_at`,
    [
      dataset.id,
      dataset.name,
      dataset.publisher,
      dataset.licence,
      dataset.licenceUrl,
      dataset.attribution,
      dataset.retrievedAt,
    ],
  );
}

export interface IngestedFunder {
  id: string;
  name: string;
  website: string | null;
  jurisdiction: Jurisdiction | null;
  sourceDatasetId: string;
}

export async function upsertFunder(tx: Queryable, funder: IngestedFunder): Promise<void> {
  await tx.query(
    `INSERT INTO funders (id, name, website, jurisdiction, source_dataset_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       website = COALESCE(EXCLUDED.website, funders.website),
       jurisdiction = COALESCE(EXCLUDED.jurisdiction, funders.jurisdiction),
       source_dataset_id = EXCLUDED.source_dataset_id`,
    [funder.id, funder.name, funder.website, funder.jurisdiction, funder.sourceDatasetId],
  );
}

/**
 * Replace everything we hold for one funder.
 *
 * Delete-then-insert rather than upsert-by-id, because a re-ingest has to be
 * able to REMOVE an award as well as change one: a publisher who withdraws or
 * corrects a grant would otherwise leave the old row behind forever, and it
 * would keep counting towards their median.
 *
 * Scoped to the one funder, so re-ingesting one publisher cannot touch
 * another's history. The caller runs it inside a transaction, so a failure
 * part way through leaves the previous data intact rather than a funder with
 * no awards at all.
 */
export async function replaceFunderAwards(
  tx: Queryable,
  funderId: string,
  awards: readonly IngestedAward[],
  sourceDatasetId: string,
): Promise<number> {
  await tx.query('DELETE FROM funder_awards WHERE funder_id = $1', [funderId]);

  let written = 0;
  for (const award of awards) {
    await tx.query(
      `INSERT INTO funder_awards
         (id, funder_id, recipient_name, amount_gbp, awarded_on, jurisdiction,
          region, tags, source_dataset_id, title, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        // Namespaced by funder: two publishers can and do use the same local
        // grant identifier, and a collision would drop one of them.
        `award_${funderId}_${award.id}`,
        funderId,
        award.recipientName,
        award.amountGbp,
        award.awardedOn,
        award.jurisdiction,
        award.region,
        award.tags,
        sourceDatasetId,
        award.title,
        award.description,
      ],
    );
    written += 1;
  }
  return written;
}

export interface FunderHolding {
  id: string;
  name: string;
  awardCount: number;
  mostRecentAward: string | null;
  licence: string | null;
  attribution: string | null;
}

/** What has been ingested so far, for the console to show. */
export async function readFunderHoldings(tx: Queryable): Promise<FunderHolding[]> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    award_count: number;
    most_recent: string | null;
    licence: string | null;
    attribution: string | null;
  }>(
    `SELECT f.id, f.name,
            count(a.id)::int AS award_count,
            max(a.awarded_on)::text AS most_recent,
            d.licence, d.attribution
       FROM funders f
       LEFT JOIN funder_awards a ON a.funder_id = f.id
       LEFT JOIN source_datasets d ON d.id = f.source_dataset_id
      GROUP BY f.id, f.name, d.licence, d.attribution
      ORDER BY count(a.id) DESC, f.name`,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    awardCount: row.award_count,
    mostRecentAward: row.most_recent,
    licence: row.licence,
    attribution: row.attribution,
  }));
}

/** Remove a funder and, by cascade, everything ingested for them. */
export async function deleteFunder(tx: Queryable, funderId: string): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    'DELETE FROM funders WHERE id = $1 RETURNING id',
    [funderId],
  );
  return rows.length === 1;
}
