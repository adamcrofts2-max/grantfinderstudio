/**
 * The state the setup guide is derived from.
 *
 * One round trip, because this runs on the home page of every account that has
 * not finished setting up. Tenant path throughout: these counts are the
 * organisation's own.
 */

import type { Queryable } from './client.js';

export interface SetupCounts {
  hasOrganisation: boolean;
  hasProject: boolean;
  confirmedFacts: number;
  opportunities: number;
  applications: number;
}

export async function readSetupCounts(tx: Queryable): Promise<SetupCounts> {
  const { rows } = await tx.query<{
    profiles: string;
    projects: string;
    facts: string;
    opportunities: string;
    applications: string;
  }>(
    `SELECT
       (SELECT count(*) FROM organisation_profiles
         WHERE form IS NOT NULL AND jurisdiction IS NOT NULL)::text AS profiles,
       (SELECT count(*) FROM projects)::text                              AS projects,
       (SELECT count(*) FROM facts
         WHERE confirmed_by IS NOT NULL AND superseded_by IS NULL)::text  AS facts,
       (SELECT count(*) FROM opportunities)::text                         AS opportunities,
       (SELECT count(*) FROM applications)::text                          AS applications`,
  );
  const row = rows[0];
  return {
    // A profile without a legal form or a jurisdiction cannot answer an
    // eligibility question, so it does not count as done.
    hasOrganisation: Number(row?.profiles ?? '0') > 0,
    hasProject: Number(row?.projects ?? '0') > 0,
    confirmedFacts: Number(row?.facts ?? '0'),
    opportunities: Number(row?.opportunities ?? '0'),
    applications: Number(row?.applications ?? '0'),
  };
}
