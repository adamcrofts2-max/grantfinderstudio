import { getDatabase } from '@/db';
import { loadOrganisation, loadProject } from '@/db/queries';
import { loadCriteriaFor, loadTracker } from '@/db/tracker';
import { DEMO_ORG_ID } from '@/demo/seed';
import { evaluateEligibility } from '@/domain/eligibility/engine';
import { isWriterAvailable, readDrafting } from '@/app/drafting';
import { toCalendarEvents, toIcs, type CalendarSource } from '@/domain/tracker/calendar';
import { remainingHours, schedule } from '@/domain/tracker/schedule';

export const dynamic = 'force-dynamic';

/**
 * Download the organisation's funding dates as an iCalendar file.
 *
 * This is the product's reminder mechanism, and deliberately not a
 * notification system. Notifications were cut from the MVP because alerting
 * over a thin opportunity feed manufactures noise — that reasoning still
 * holds. But a person's own committed deadlines are real data, and they
 * already own something that reminds them reliably at seven in the morning.
 * We hand it the dates rather than competing with it.
 *
 * A download rather than a subscribable feed: a feed URL would have to be
 * fetchable by Google's servers without a session, and inventing an
 * unauthenticated token for tenant data is not a decision to make in passing.
 */
export async function GET(): Promise<Response> {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);

  const database = await getDatabase();
  // Outside the transaction: see the guard in withAdmin.
  const writerAvailable = await isWriterAvailable();
  const loaded = await database.withTenant(DEMO_ORG_ID, async (tx) => {
    const tracker = await loadTracker(tx);
    const ids = [
      ...tracker.applications.map((a) => a.opportunityId).filter((id) => id !== null),
      ...tracker.notStarted.map((o) => o.id),
    ];
    return {
      tracker,
      criteria: await loadCriteriaFor(tx, ids),
      organisation: await loadOrganisation(tx),
      project: await loadProject(tx),
      drafting: await readDrafting(tx, writerAvailable),
    };
  });
  const { tracker, organisation, project } = loaded;
  const mode = loaded.drafting.mode;

  /** A fund the engine rules you out of has no business in your diary. */
  const ruledOut = (opportunityId: string | null): boolean => {
    if (opportunityId === null || organisation === null || project === null) return false;
    const criteria = loaded.criteria.get(opportunityId);
    if (criteria === undefined) return false;
    return (
      evaluateEligibility(organisation.profile, project, criteria, { asOf: day }).verdict ===
      'ineligible'
    );
  };

  const sources: CalendarSource[] = [];

  for (const app of tracker.applications) {
    // A submitted application has no live dates left to warn anyone about.
    if (app.submittedOn !== null) continue;
    if (ruledOut(app.opportunityId)) continue;
    const hours = remainingHours(app.questions, {
      mode,
      unsupportedClaims: app.unsupported,
    });
    const state = schedule(
      {
        deadline: app.deadline,
        deadlineKind: app.deadlineKind,
        hoursRemaining: hours,
        started: app.answered > 0,
        submittedOn: null,
      },
      day,
    );
    sources.push({
      id: app.id,
      title: app.title ?? 'Untitled application',
      funderName: app.funderName,
      deadline: app.deadline,
      dateIsFirm: state.dateIsFirm,
      latestStart: state.latestStart,
      hoursRemaining: hours,
      url: app.sourceUrl ?? undefined,
    });
  }

  for (const opportunity of tracker.notStarted) {
    if (opportunity.deadline === null) continue;
    if (ruledOut(opportunity.id)) continue;
    sources.push({
      id: opportunity.id,
      title: opportunity.title,
      funderName: opportunity.funderName,
      deadline: opportunity.deadline,
      dateIsFirm: opportunity.deadlineKind === 'confirmed',
      // The form has not been seen, so there is no honest start date to give.
      latestStart: null,
      hoursRemaining: null,
      url: opportunity.sourceUrl ?? undefined,
    });
  }

  return new Response(toIcs(toCalendarEvents(sources), now), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="funding-deadlines.ics"',
      'cache-control': 'no-store',
    },
  });
}
