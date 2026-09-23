import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadOrganisation, loadProject } from '@/db/queries';
import {
  loadCriteriaFor,
  loadTracker,
  type TrackedApplication,
  type TrackedOpportunity,
} from '@/db/tracker';

import { evaluateEligibility } from '@/domain/eligibility/engine';
import type { DraftingMode } from '@/domain/effort/model';
import { isWriterAvailable, readDrafting } from '@/app/drafting';
import {
  needsAttention,
  remainingHours,
  schedule,
  SCHEDULE_CONSTANTS,
  type Schedule,
} from '@/domain/tracker/schedule';
import { horizonFor, timeline, type Horizon } from '@/domain/tracker/timeline';
import { Timeline } from '@/app/viz/Timeline';
import { Highlight, MarginNote } from '@/app/marks';
import { EmptyState } from '@/app/illustration/EmptyState';
import { DECISION_BADGE, decisionLine, gbp, humanDate } from '@/app/components';

import { decisionSummary } from '@/domain/tracker/decision';

import {
  clearDecisionAction,
  markSubmittedAction,
  unmarkSubmittedAction,
} from './actions';
import { DecisionForm } from './DecisionForm';
import {
  GROUPS,
  paceNote,
  relativeDays,
  RULED_OUT_BADGE,
  STATE_LABEL,
  STATE_TONE,
  today,
  type Group,
} from './state';

export const dynamic = 'force-dynamic';

interface Row {
  key: string;
  href: string;
  title: string;
  funderName: string | null;
  schedule: Schedule;
  deadline: string | null;
  /** Present only for started applications. */
  application: TrackedApplication | null;
  amountGbp: number | null;
  verdict: Verdict;
  group: Group;
}

type Verdict = 'eligible' | 'ineligible' | 'unknown' | undefined;

/**
 * Where a row belongs.
 *
 * Eligibility overrides urgency. Telling someone to drop everything for a fund
 * the deterministic engine has already ruled them out of would be the product
 * arguing with itself, and it is the fastest way to teach people to ignore the
 * tracker. It is set aside rather than hidden: the applicant may know
 * something about the funder that we do not, and the fund stays one click
 * away.
 */
function groupFor(
  state: Schedule['state'],
  started: boolean,
  verdict: Verdict,
  decided: boolean,
): Group {
  // An answered application is past every other judgement this function
  // makes. Its deadline, its eligibility and its remaining work are all
  // settled facts now, and re-deciding them would put a funded grant under
  // "Needs you this week".
  if (decided) return 'answered';
  if (state === 'submitted') return 'done';
  if (verdict === 'ineligible') return 'ruled_out';
  if (needsAttention(state)) return 'attention';
  if (state === 'no_clock') return started ? 'open' : 'watching';
  return started ? 'ahead' : 'watching';
}

function applicationRow(
  app: TrackedApplication,
  now: string,
  verdict: Verdict,
  mode: DraftingMode,
): Row {
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
      submittedOn: app.submittedOn,
    },
    now,
  );
  return {
    key: app.id,
    href: `/applications/${app.id}`,
    title: app.title ?? 'Untitled application',
    funderName: app.funderName,
    schedule: state,
    deadline: app.deadline,
    application: app,
    amountGbp: app.amountRequestedGbp,
    verdict,
    group: groupFor(state.state, true, verdict, app.decision !== null),
  };
}

function opportunityRow(opportunity: TrackedOpportunity, now: string, verdict: Verdict): Row {
  // Nothing is drafted, so the work is unmeasured — the schedule says so
  // rather than implying the form is empty of effort.
  const state = schedule(
    {
      deadline: opportunity.deadline,
      deadlineKind: opportunity.deadlineKind,
      hoursRemaining: null,
      started: false,
      submittedOn: null,
    },
    now,
  );
  return {
    key: opportunity.id,
    href: `/opportunities/${opportunity.id}`,
    title: opportunity.title,
    funderName: opportunity.funderName,
    schedule: state,
    deadline: opportunity.deadline,
    application: null,
    amountGbp: opportunity.maxAmountGbp,
    verdict,
    group: groupFor(state.state, false, verdict, false),
  };
}

/** The deadline line: the date, how far off it is, and how much to trust it. */
function DeadlineLine({ row }: { row: Row }) {
  // A decided application's deadline is history. The date that matters on
  // that row is the day the funder answered, and the line below carries it.
  if (row.application?.decision != null) return null;
  if (row.deadline === null) {
    return <p className="criteria-why">No date published</p>;
  }
  const { daysRemaining, dateIsFirm } = row.schedule;
  return (
    <p className="criteria-why">
      {humanDate(row.deadline)}
      {daysRemaining === null ? null : ` · ${relativeDays(daysRemaining)}`}
      {dateIsFirm ? null : ' · date not confirmed by the funder'}
    </p>
  );
}

/**
 * The track under a row, or nothing.
 *
 * Ruled-out funds get no timeline: there is nothing to schedule, and drawing
 * urgency for a fund you cannot apply to would have the card argue with its
 * own heading. Rolling funds and submitted work have no position in time and
 * the domain returns null for them.
 */
function RowTimeline({ row, horizon }: { row: Row; horizon: Horizon | null }) {
  if (row.verdict === 'ineligible' || horizon === null) return null;
  const drawn = timeline(row.schedule, horizon.days);
  if (drawn === null) return null;
  const remaining = row.schedule.daysRemaining;
  return (
    <Timeline
      timeline={drawn}
      tone={STATE_TONE[row.schedule.state]}
      description={row.schedule.reason}
      endLabel={
        drawn.beyond
          ? `over ${horizon.days} days away`
          : remaining === null
            ? ''
            : relativeDays(remaining)
      }
    />
  );
}

/**
 * The margin note pointing at the timeline's start tick.
 *
 * It annotates the CHART, not the sentence above it. The sentence already
 * names the date; circling it there would print the same date twice, and a
 * mark that repeats what is beside it is decoration.
 */
function StartNote({ row, horizon }: { row: Row; horizon: Horizon | null }) {
  if (row.verdict === 'ineligible' || horizon === null) return null;
  const drawn = timeline(row.schedule, horizon.days);
  if (drawn === null || drawn.workUnknown || drawn.overdue) return null;
  if (drawn.overruns) return <MarginNote>this should already be running</MarginNote>;
  if (row.schedule.latestStart === null) return null;
  // The note sits at whichever end of the track the start tick is nearest, so
  // its arrow points at the mark rather than away from it.
  return (
    <MarginNote align={drawn.worksFrom >= 50 ? 'end' : 'start'}>
      the last day you can still start
    </MarginNote>
  );
}

function TrackerRow({
  row,
  horizon,
  now,
}: {
  row: Row;
  horizon: Horizon | null;
  now: string;
}) {
  const ruledOut = row.verdict === 'ineligible';
  const app = row.application;
  const decision = app?.decision ?? null;
  // An answer outranks both of the other two badges: once a funder has
  // spoken, neither the schedule nor the eligibility engine has anything left
  // to say about this row.
  const badge =
    decision !== null
      ? DECISION_BADGE[decision]
      : ruledOut
        ? RULED_OUT_BADGE
        : STATE_LABEL[row.schedule.state];

  return (
    <section className="card">
      <div className="row-between">
        <div style={{ flex: '1 1 18rem', minWidth: 0 }}>
          <a className="opportunity" href={row.href}>
            <h3 className="opportunity-title">{row.title}</h3>
            <p className="opportunity-funder">{row.funderName ?? 'Unknown funder'}</p>
          </a>
          <DeadlineLine row={row} />
          <p className="headline" style={{ fontWeight: 500 }}>
            {decision !== null && app !== null
              ? decisionLine({
                  decision,
                  decidedOn: app.decidedOn,
                  amountAwardedGbp: app.amountAwardedGbp,
                  amountRequestedGbp: app.amountRequestedGbp,
                })
              : ruledOut
                ? 'The eligibility check rules you out of this one, so there is nothing here to schedule. Open it to see which rule fails.'
                : row.schedule.reason}
          </p>
          {decision === null ? <RowTimeline row={row} horizon={horizon} /> : null}
          {decision === null ? <StartNote row={row} horizon={horizon} /> : null}
          {app !== null && app.outcomeNote !== null ? (
            <blockquote className="decision-note">{app.outcomeNote}</blockquote>
          ) : null}
          {decision === null && row.verdict === 'unknown' ? (
            <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
              <span aria-hidden="true">⚠</span>
              <span>
                Eligibility is unresolved. Settle that before spending hours here — the
                opportunity page shows which question is open.
              </span>
            </p>
          ) : null}
          {app === null ? null : (
            <p className="criteria-why" style={{ marginTop: 'var(--s-2)' }}>
              {app.questions.length === 0
                ? 'No questions pasted in yet'
                : `${app.answered} of ${app.questions.length} questions answered`}
              {row.amountGbp === null ? null : ` · ${gbp(row.amountGbp)}`}
              {app.unsupported > 0
                ? ` · ${app.unsupported} unsupported ${app.unsupported === 1 ? 'claim' : 'claims'} to resolve`
                : null}
            </p>
          )}
        </div>
        <div className="metric">
          <span className={badge.className}>
            <span aria-hidden="true">{badge.mark}</span>
            {badge.label}
          </span>
          {app === null ? null : (
            <form
              action={
                decision !== null
                  ? clearDecisionAction
                  : app.submittedOn === null
                    ? markSubmittedAction
                    : unmarkSubmittedAction
              }
              style={{ marginTop: 'var(--s-3)' }}
            >
              <input type="hidden" name="applicationId" value={app.id} />
              <button
                className={decision === null ? 'btn btn-secondary' : 'btn btn-quiet'}
                type="submit"
              >
                {decision !== null
                  ? 'Not answered after all'
                  : app.submittedOn === null
                    ? 'Mark submitted'
                    : 'Not submitted after all'}
              </button>
            </form>
          )}
        </div>
      </div>
      {/* Only on a row that has gone in and has no answer yet. Offering it on
          a draft would invite an award recorded against an application nobody
          has sent, which the action refuses anyway — better not to ask. */}
      {app !== null && app.submittedOn !== null && decision === null ? (
        <DecisionForm applicationId={app.id} today={now} />
      ) : null}
    </section>
  );
}

export default async function TrackerPage() {
  const organisationId = await requireOrganisationId();
  const now = today();
  const database = await getDatabase();
  // Resolved before the tenant transaction opens: it takes the operator
  // connection, and asking for that while a tenant transaction is held is a
  // deadlock.
  const writerAvailable = await isWriterAvailable();
  const page = await database.withTenant(organisationId, async (tx) => {
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

  const { tracker, organisation, project, drafting } = page;
  const mode = drafting.mode;

  /**
   * Eligibility for one fund, or undefined when the organisation's own details
   * are not yet in. No profile means no verdict — never a default of "fine".
   */
  const verdictFor = (opportunityId: string | null): Verdict => {
    if (opportunityId === null || organisation === null || project === null) return undefined;
    const criteria = page.criteria.get(opportunityId);
    if (criteria === undefined) return undefined;
    return evaluateEligibility(organisation.profile, project, criteria, { asOf: now }).verdict;
  };

  const rows: Row[] = [
    ...tracker.applications.map((app) =>
      applicationRow(app, now, verdictFor(app.opportunityId), mode),
    ),
    ...tracker.notStarted.map((opportunity) =>
      opportunityRow(opportunity, now, verdictFor(opportunity.id)),
    ),
  ];

  // Within a group, soonest first; anything without a date sorts to the end.
  const sorted = rows.toSorted((a, b) => {
    const left = a.schedule.daysRemaining;
    const right = b.schedule.daysRemaining;
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  });

  const attention = sorted.filter((row) => row.group === 'attention');

  // flatMap rather than filter-then-assert: the narrowing is the point, and a
  // non-null assertion here would be the one place in this file where the
  // types stop being load-bearing.
  const outcomes = decisionSummary(
    tracker.applications.flatMap((app) =>
      app.decision === null
        ? []
        : [
            {
              decision: app.decision,
              amountAwardedGbp: app.amountAwardedGbp,
              amountRequestedGbp: app.amountRequestedGbp,
            },
          ],
    ),
  );

  return (
    <div className="page">
      <header className="page-head">
        <p className="eyebrow">Tracker</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {/* The one title in the product that reports a FINDING rather than
              naming a screen, which is what earns it the highlighter. */}
          <Highlight>
            {attention.length === 0
              ? 'Nothing is slipping'
              : `${attention.length} ${attention.length === 1 ? 'thing needs' : 'things need'} your attention`}
          </Highlight>
        </h1>
        <p className="page-sub">
          A deadline on its own tells you nothing you did not already know. What matters is the
          last day you can still start — so every date here is worked back through the work still
          to do, at <strong>{SCHEDULE_CONSTANTS.defaultHoursPerWeek} hours a week</strong>
          {mode === 'assisted' ? ' with the Writer drafting' : ' writing unaided'}.
        </p>
        <div className="row" style={{ marginTop: 'var(--s-4)' }}>
          <a className="btn btn-secondary" href="/api/tracker/calendar" download>
            Add these dates to your calendar
          </a>
          <span className="hint">
            Downloads an <code>.ics</code> file. Open it and your own calendar does the reminding —
            a week before each deadline, a day before each start date.
          </span>
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          figure="Planner"
          title="Nothing to track yet"
          action={<a className="btn btn-primary" href="/">See your opportunities</a>}
        >
          Once there are opportunities to look at, their deadlines appear here — each one worked
          back to the last day you could still start it.
        </EmptyState>
      ) : null}

      {GROUPS.map((group) => {
        const items = sorted.filter((row) => row.group === group.id);
        if (items.length === 0) return null;
        // One axis for the whole group, so track lengths are comparable down
        // the page rather than each row being scaled to its own deadline.
        const horizon = horizonFor(items.map((row) => row.schedule));
        return (
          <section key={group.id} style={{ marginTop: 'var(--s-6)' }}>
            <h2 className="card-title">
              {group.title}{' '}
              <span className="metric-label" style={{ textTransform: 'none' }}>
                ({items.length})
              </span>
            </h2>
            <p className="card-sub" style={{ marginBottom: 'var(--s-4)', maxWidth: '46rem' }}>
              {group.blurb}
            </p>
            {/* The tally sits with its own rows rather than at the top of the
                page. It is a summary of these applications, and a figure
                floating above every other group would read as a claim about
                all of them. */}
            {group.id === 'answered' ? (
              <section className="card" style={{ marginBottom: 'var(--s-4)' }}>
                <p className="eyebrow">Your own record</p>
                <p className="headline" style={{ marginTop: 'var(--s-2)', fontWeight: 500 }}>
                  {outcomes.sentence}
                </p>
                {outcomes.askedGbp > 0 ? (
                  <p className="hint" style={{ marginTop: 'var(--s-2)' }}>
                    {/* One decided application read "across the 1 a funder
                        actually decided" — found on the September 2026 walk. */}
                    {outcomes.awarded + outcomes.rejected === 1
                      ? `Against the ${gbp(outcomes.askedGbp)} you asked for.`
                      : `Against ${gbp(outcomes.askedGbp)} asked for across the ${
                          outcomes.awarded + outcomes.rejected
                        } applications a funder actually decided.`}
                    {outcomes.noReply > 0
                      ? ' Applications nobody answered are left out of both halves.'
                      : null}
                  </p>
                ) : null}
              </section>
            ) : null}
            <div className="stack">
              {items.map((row) => (
                <TrackerRow key={row.key} row={row} horizon={horizon} now={now} />
              ))}
            </div>
          </section>
        );
      })}

      <section className="card" style={{ marginTop: 'var(--s-6)' }}>
        <h2 className="card-title">How these timings are worked out</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          {paceNote(mode, drafting.reason, drafting.usableFacts)}
        </p>
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          On top of that: {SCHEDULE_CONSTANTS.defaultHoursPerWeek} hours a week to give it,{' '}
          {SCHEDULE_CONSTANTS.assumedWordsPerUnlimitedQuestion} words assumed for a question the
          funder set no limit on, and 15 minutes for every drafted claim no confirmed fact
          supports — those are real outstanding work, and drafting creates them rather than
          removing them. Estimates of effort, not predictions of success: this product does not
          claim to know your chances.
        </p>
      </section>
    </div>
  );
}
