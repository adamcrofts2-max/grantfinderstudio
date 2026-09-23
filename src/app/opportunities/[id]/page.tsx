import { notFound } from 'next/navigation';
import { draftFunderEnquiry } from '@/domain/assessment/enquiry';
import { assessOpportunity } from '@/domain/assessment/assess';
import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import {
  loadAwards,
  loadAwardSources,
  loadCriteria,
  loadOpportunity,
  loadOrganisation,
  loadProject,
} from '@/db/queries';
import { findApplicationForOpportunity } from '@/db/workspace';
import { loadOwnFund } from '@/db/own-funds';
import { isWriterAvailable, readDrafting } from '@/app/drafting';
import { startApplicationAction } from '@/app/applications/actions';
import { applicationFeaturesFor } from '@/demo/seed';
import { Card, gbp, Notice, OutcomeBadge, RecommendationPill } from '@/app/components';
import { Circled } from '@/app/marks';
import { FindTheirPage } from '@/app/FindTheirPage';

export const dynamic = 'force-dynamic';

/** "this month", "last month", "3 months ago" — never "1 months ago". */
function monthsAgo(months: number): string {
  if (months <= 0) return 'this month';
  if (months === 1) return 'last month';
  return `${months} months ago`;
}

export default async function OpportunityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();
  const asOf = new Date().toISOString().slice(0, 10);

  // Outside the transaction: see the guard in withAdmin.
  const writerAvailable = await isWriterAvailable();

  const page = await database.withTenant(organisationId, async (tx) => {
    const opportunity = await loadOpportunity(tx, id);
    if (!opportunity) return null;
    const organisation = await loadOrganisation(tx);
    const project = await loadProject(tx);
    if (!organisation || !project) return null;
    const { criteria } = await loadCriteria(tx, opportunity.id);
    const awards = await loadAwards(tx, opportunity.funderId);
    const awardSources = await loadAwardSources(tx, opportunity.funderId);
    const application = await findApplicationForOpportunity(tx, opportunity.id);
    const drafting = await readDrafting(tx, writerAvailable);
    // Whether this organisation ADDED it — not whether it can see it, which
    // is also true of every shared catalogue fund.
    const own = (await loadOwnFund(tx, opportunity.id)) !== null;
    return {
      own,
      ruleCount: criteria.length,
      opportunity,
      organisation,
      project,
      awards,
      awardSources,
      application,
      assessment: assessOpportunity({
        applicant: organisation.profile,
        project,
        opportunity,
        criteria,
        awards,
        features: applicationFeaturesFor(opportunity.id).features,
        // A fund the applicant pasted in has no known form. Saying so beats an
        // estimate derived from an empty feature set.
        featuresKnown: applicationFeaturesFor(opportunity.id).known,
        drafting: drafting.mode,
        asOf,
      }),
    };
  });

  if (!page) notFound();
  const { opportunity, organisation, project, assessment, application, own, ruleCount } = page;
  const editHref = `/opportunities/${opportunity.id}/edit`;

  const enquiry =
    assessment.openQuestions.length > 0
      ? draftFunderEnquiry({
          organisationName: organisation.name,
          senderName: null,
          funderName: opportunity.funderName,
          opportunityTitle: opportunity.title,
          projectSummary: project.description,
          questions: assessment.openQuestions,
        })
      : null;

  const behaviour =
    assessment.funderBehaviour.kind === 'summary' ? assessment.funderBehaviour.behaviour : null;

  return (
    <div className="page page-narrow">
      <p style={{ marginBottom: 'var(--s-4)' }}>
        <a href="/"><span aria-hidden="true">← </span>All opportunities</a>
      </p>

      <header className="page-head">
        <p className="eyebrow">{opportunity.funderName}</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>{opportunity.title}</h1>
        <div style={{ margin: 'var(--s-4) 0 var(--s-3)' }}>
          <RecommendationPill value={assessment.recommendation.recommendation} />
        </div>
        <p style={{ fontSize: 'var(--t-md)', fontWeight: 600 }}>{assessment.headline}</p>
        <p className="page-sub">{assessment.recommendation.reason}</p>
        {own ? (
          <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
            You added this fund. <a href={editHref}>Change its details, its rules, or remove it</a>.
          </p>
        ) : null}
      </header>

      <Card title="1 · Eligibility">
        {/* A fund typed in by hand arrives with no rules, and until it has
            some this card can only ever say "we cannot yet tell". The rules
            are almost always on the funder's page; this is where to put them. */}
        {own && ruleCount === 0 ? (
          <div className="notice notice-neutral" style={{ marginBottom: 'var(--s-4)' }}>
            <span>
              This fund has no eligibility rules yet, so there is nothing to check you against.
              Take them from the funder’s guidance — who may apply, where, how much — and each
              one is checked here.{' '}
              <a href={`${editHref}#rules`}>Add their rules</a>
            </span>
          </div>
        ) : null}
        <ul className="criteria">
          {assessment.eligibility.results.map((result) => (
            <li key={result.criterionId}>
              <span className="criteria-badge">
                <OutcomeBadge outcome={result.outcome} />
              </span>
              <span className="criteria-body">
                <strong className="criteria-name">{result.label}</strong>
                <span className="criteria-why">{result.reason}</span>
              </span>
            </li>
          ))}
        </ul>
        <p style={{ marginTop: 'var(--s-4)', fontSize: 'var(--t-sm)' }}>
          Overall:{' '}
          <strong>
            {assessment.eligibility.verdict === 'eligible'
              ? 'You meet every criterion we can check.'
              : assessment.eligibility.verdict === 'ineligible'
                ? 'You are not eligible for this fund.'
                : 'We cannot yet tell whether you are eligible.'}
          </strong>
          {own && ruleCount > 0 ? (
            <>
              {' '}
              <a href={`${editHref}#rules`}>Change these rules</a>
            </>
          ) : null}
        </p>
      </Card>

      <Card title="2 · What this funder actually funds">
        {behaviour === null ? (
          <p style={{ margin: 0, color: 'var(--ink-soft)' }}>
            {assessment.funderBehaviour.kind === 'too_few_awards'
              ? assessment.funderBehaviour.reason
              : null}
          </p>
        ) : (
          <>
            <p style={{ margin: '0 0 0.6rem' }}>
              Based on <strong>{behaviour.awardCount} awarded grants</strong>. Typical award{' '}
              <strong>
                {gbp(behaviour.amounts.lowerQuartile)}–{gbp(behaviour.amounts.upperQuartile)}
              </strong>{' '}
              (median {gbp(behaviour.amounts.median)}), ranging {gbp(behaviour.amounts.min)} to{' '}
              {gbp(behaviour.amounts.max)}.
            </p>
            {assessment.amountAssessment ? (
              <p style={{ margin: '0 0 0.6rem' }}>{assessment.amountAssessment.message}</p>
            ) : null}
            {behaviour.regions.length > 0 ? (
              <p className="hint" style={{ margin: '0 0 var(--s-2)' }}>
                Most funded areas:{' '}
                {behaviour.regions
                  .slice(0, 3)
                  .map((r) => `${r.value} (${r.count})`)
                  .join(', ')}
                . Most recent award {monthsAgo(behaviour.monthsSinceMostRecentAward)}.
              </p>
            ) : null}
            {/* THE AWARDS' source, not the fund's. A fund typed in by hand has
                none, and this line sits under the award evidence — whose
                licences, mostly CC BY, make attribution a condition of
                showing it at all. */}
            <p className="hint" style={{ margin: 0 }}>
              Source:{' '}
              {page.awardSources.length === 0
                ? 'unknown'
                : page.awardSources.map((d) => `${d.attribution} (${d.licence})`).join('; ')}
            </p>
          </>
        )}
      </Card>

      <Card title="3 · What applying would cost you">
        {assessment.effortKnown ? null : (
          <p className="notice notice-neutral">
            <span>
              Nobody has seen this funder’s form yet, so we cannot tell you what it would cost.
              Start an application and paste their questions in, and this fills itself in.
            </span>
          </p>
        )}
        {assessment.effortKnown ? (
          <p style={{ fontSize: 'var(--t-lg)', fontWeight: 660, marginBottom: 'var(--s-3)' }}>
            {/* The number the whole card exists to produce, and the one that
                decides whether this is worth twenty evenings. One circle per
                card — a page with four circled things has circled nothing. */}
            About <Circled>{assessment.effort.hours} hours</Circled>{' '}
            <span style={{ color: 'var(--ink-faint)', fontWeight: 500, fontSize: 'var(--t-base)' }}>
              · {assessment.effort.band} effort
            </span>
          </p>
        ) : null}
        <ul className="drivers" hidden={!assessment.effortKnown}>
          {assessment.effort.drivers.map((driver) => (
            <li key={driver.label}>
              <span>{driver.label}</span>
              <b>{driver.hours}h</b>
            </li>
          ))}
        </ul>
      </Card>

      {enquiry ? (
        <Card title="Settle the open questions first">
          <p style={{ margin: '0 0 0.8rem' }}>
            {assessment.openQuestions.length === 1
              ? 'One question is unresolved. Funders answer these routinely — here is a draft you can send.'
              : `${assessment.openQuestions.length} questions are unresolved. Funders answer these routinely — here is a draft you can send.`}
          </p>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
            <strong>Subject:</strong> {enquiry.subject}
          </p>
          <pre className="email-preview">{enquiry.body}</pre>
        </Card>
      ) : null}

      {application === null ? (
        <Card title="Ready to apply?">
          <p style={{ marginBottom: 'var(--s-3)' }}>
            {assessment.eligibility.verdict === 'ineligible'
              ? 'You do not meet this funder’s criteria, so we would not spend the time — but it is your call, and you may know something about them that we do not.'
              : assessment.eligibility.verdict === 'unknown'
                ? 'Some eligibility questions are still open. You can start anyway and settle them as you go.'
                : 'Start an application and paste the funder’s questions straight in from their form.'}
          </p>
          <form action={startApplicationAction}>
            <input type="hidden" name="opportunityId" value={opportunity.id} />
            <button
              className={`btn ${assessment.eligibility.verdict === 'ineligible' ? 'btn-secondary' : 'btn-primary'}`}
              type="submit"
            >
              Start an application
            </button>
          </form>
        </Card>
      ) : (
        <Card title="Your application">
          <p style={{ marginBottom: 'var(--s-3)' }}>
            {application.total === 0
              ? 'No questions yet — paste them in from the funder’s form.'
              : `${application.answered} of ${application.total} questions answered.`}
          </p>
          <a className="btn btn-primary" href={`/applications/${application.id}`}>
            Open the workspace
          </a>
        </Card>
      )}

      <Card title="Before you apply">
        <Notice tone={assessment.deadlineNotice.tone}>{assessment.deadlineNotice.text}</Notice>
        <Notice tone={assessment.freshnessNotice.tone}>{assessment.freshnessNotice.text}</Notice>
        <Notice tone="caution">{assessment.verifyNotice}</Notice>
        {/* Where to check it, in the order of how close each gets to the
            fund itself. The last used to be nothing at all — the trail went
            cold exactly where the notices above tell you to go and check. */}
        <p style={{ margin: 'var(--s-2) 0 0', fontSize: 'var(--t-sm)' }}>
          {opportunity.sourceUrl ? (
            <a href={opportunity.sourceUrl} style={{ color: 'var(--accent)' }}>
              The funder&rsquo;s own page for this fund
            </a>
          ) : opportunity.funderWebsite ? (
            <a
              href={opportunity.funderWebsite}
              rel="noreferrer noopener"
              style={{ color: 'var(--accent)' }}
              target="_blank"
            >
              {opportunity.funderName}&rsquo;s website
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <FindTheirPage
              funder={{ id: opportunity.funderId, name: opportunity.funderName }}
              lead="We hold no link for this fund or its funder."
            />
          )}
        </p>
      </Card>
    </div>
  );
}
