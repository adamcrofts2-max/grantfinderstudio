/**
 * The state the setup guide is derived from.
 *
 * One round trip, because this runs on the home page of every account that has
 * not finished setting up. Tenant path throughout: these counts are the
 * organisation's own.
 */

import type { Queryable } from './client.js';
import { WORK_CLAIMS } from '../domain/provenance/about-the-work.js';

export interface SetupCounts {
  hasOrganisation: boolean;
  hasProject: boolean;
  confirmedFacts: number;
  pendingFacts: number;
  /**
   * Which of the claims about the WORK are confirmed. Not a count: "what you
   * do" is answered by either a mission or a programme description, so two of
   * those are one answer, not two.
   */
  confirmedWorkClaims: string[];
  /** The same, waiting to be checked — read off a website, say. */
  pendingWorkClaims: string[];
  opportunities: number;
  applications: number;
}

export async function readSetupCounts(tx: Queryable): Promise<SetupCounts> {
  const { rows } = await tx.query<{
    profiles: string;
    projects: string;
    facts: string;
    pending: string;
    opportunities: string;
    applications: string;
    work: string[] | null;
    pending_work: string[] | null;
  }>(
    `SELECT
       (SELECT count(*) FROM organisation_profiles
         WHERE form IS NOT NULL AND jurisdiction IS NOT NULL)::text AS profiles,
       (SELECT count(*) FROM projects)::text                              AS projects,
       (SELECT count(*) FROM facts
         WHERE confirmed_by IS NOT NULL AND superseded_by IS NULL)::text  AS facts,
       (SELECT count(*) FROM facts
         WHERE confirmed_by IS NULL AND superseded_by IS NULL)::text      AS pending,
       (SELECT count(*) FROM opportunities
         WHERE added_by_organisation_id
               = current_setting('app.organisation_id', true))::text       AS opportunities,
       (SELECT count(*) FROM applications)::text                          AS applications,
       (SELECT array_agg(DISTINCT claim) FROM facts
         WHERE confirmed_by IS NOT NULL AND superseded_by IS NULL
           AND claim = ANY($1::text[]))                                   AS work,
       (SELECT array_agg(DISTINCT claim) FROM facts
         WHERE confirmed_by IS NULL AND superseded_by IS NULL
           AND claim = ANY($1::text[]))                                   AS pending_work`,
    [WORK_CLAIMS],
  );
  const row = rows[0];
  return {
    // A profile without a legal form or a jurisdiction cannot answer an
    // eligibility question, so it does not count as done.
    hasOrganisation: Number(row?.profiles ?? '0') > 0,
    hasProject: Number(row?.projects ?? '0') > 0,
    confirmedFacts: Number(row?.facts ?? '0'),
    // Nothing waiting means "confirm the rest" has nothing to act on.
    pendingFacts: Number(row?.pending ?? '0'),
    confirmedWorkClaims: row?.work ?? [],
    pendingWorkClaims: row?.pending_work ?? [],
    // Funds THIS organisation added, not every fund it can see. Shared
    // reference rows are visible to everybody, so counting those would tick
    // "add a fund you are considering" off for somebody who never added one —
    // and once there is a shared catalogue that would be every new account.
    opportunities: Number(row?.opportunities ?? '0'),
    applications: Number(row?.applications ?? '0'),
  };
}
