import { notFound } from 'next/navigation';
import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadApplication, loadClaimRefs, loadFacts } from '@/db/workspace';
import { loadBudgetLines } from '@/db/budget';
import { loadOutcomes } from '@/db/outcomes';
import { loadCriteria } from '@/db/queries';
import { claimStanding, usableFacts } from '@/domain/provenance/facts';
import { assessReadiness } from '@/domain/readiness/readiness';
import { validateBudget } from '@/domain/budget/validate';
import { restrictionsFromCriteria } from '@/domain/budget/restrictions';

import { Workspace, type QuestionView } from './Workspace';
import { PasteQuestions } from './PasteQuestions';
import { ReviewPanel } from './ReviewPanel';
import { BudgetPanel } from './BudgetPanel';
import { OutcomesPanel } from './OutcomesPanel';
import { CopyButton } from './CopyButton';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();

  const page = await database.withTenant(organisationId, async (tx) => {
    const application = await loadApplication(tx, id);
    if (!application) return null;
    const facts = await loadFacts(tx);
    const budgetLines = await loadBudgetLines(tx, id);
    const outcomes = await loadOutcomes(tx, id);
    // Only criteria a human has verified — `loadCriteria` filters on
    // `verified_at`, which is what makes the budget check the funder's rule
    // rather than somebody's reading of their prose.
    // `mapCriteria` also reports rows it could not read; a criterion that
    // does not map is not a rule, so it is not one the budget is checked
    // against either.
    const criteria =
      application.opportunityId === null
        ? []
        : (await loadCriteria(tx, application.opportunityId)).criteria;

    const questions: QuestionView[] = [];
    for (const q of application.questions) {
      const answer = application.answers.get(q.id) ?? null;
      questions.push({
        id: q.id,
        position: q.position,
        question: q.question,
        wordLimit: q.word_limit,
        assesses: q.assesses,
        answer: answer?.content ?? null,
        wordCount: answer?.word_count ?? 0,
        claims: answer
          ? (await loadClaimRefs(tx, q.id)).map((c) => ({
              text: c.claimText,
              factId: c.factId,
              /**
               * Resolved HERE, where the fact base is.
               *
               * The workspace used to decide this itself, from `factId ===
               * null` alone — so a linking sentence that asserts nothing
               * factual was highlighted as "nothing behind it" while the
               * action reported "every claim traced to a confirmed fact". One
               * card said both. See `claimStanding`.
               */
              standing: claimStanding(c.factId, facts),
            }))
          : [],
      });
    }
    return { application, facts, questions, budgetLines, outcomes, criteria };
  });

  if (!page) notFound();
  const { application, facts, questions, budgetLines, outcomes, criteria } = page;

  const confirmed = usableFacts(facts);
  const answered = questions.filter((q) => q.answer !== null && q.answer !== '').length;
  const unsupported = questions.filter((q) =>
    q.claims.some((claim) => claim.standing === 'unsupported'),
  ).length;
  const overLimit = questions.filter(
    (q) => q.wordLimit !== null && q.wordCount > q.wordLimit,
  ).length;

  // Question and answer together, so it reads as a document rather than a
  // wall of prose with no context.
  const wholeApplication = questions
    .filter((q) => q.answer !== null && q.answer !== '')
    .map((q) => {
      const limit = q.wordLimit === null ? '' : ` (${q.wordCount}/${q.wordLimit} words)`;
      return `${q.position}. ${q.question}${limit}\n\n${q.answer ?? ''}`;
    })
    .join('\n\n---\n\n');

  // The funder's own verified terms, and what they leave unchecked. Two of
  // `validateBudget`'s rules have no criterion kind behind them and are never
  // filled — see `restrictionsFromCriteria`, which returns that list so the
  // card can say so rather than implying a check it did not make.
  const funderRules = restrictionsFromCriteria(criteria);
  const budget = validateBudget(
    budgetLines,
    funderRules.restrictions,
    application.amountRequestedGbp,
  );

  const readiness = assessReadiness({
    // UNKNOWN, because nothing here has evaluated it. This said 'eligible' —
    // so the card claimed "you meet every criterion we can check" on every
    // application ever opened, whatever the eligibility engine thought, and
    // scored it full marks for doing so. Running the engine properly needs
    // the applicant profile and project this query does not load; until it
    // does, "we have not checked" is the true answer and 'unknown' is how
    // this domain says it. On the roadmap to wire for real.
    eligibilityVerdict: 'unknown',
    questionsTotal: questions.length,
    questionsAnswered: answered,
    answersWithUnsupportedClaims: unsupported,
    evidenceNeeded: 0,
    evidenceProvided: 0,
    budgetSubmittable: budget.isSubmittable,
    budgetHasLines: budgetLines.length > 0,
    outcomesDefined: outcomes.length,
    attachmentsRequired: 0,
    attachmentsProvided: 0,
    answersOverWordLimit: overLimit,
  });

  return (
    <div className="page page-narrow">
      <p style={{ marginBottom: 'var(--s-4)' }}>
        <a href="/"><span aria-hidden="true">← </span>All opportunities</a>
      </p>

      <header className="page-head">
        <p className="eyebrow">{application.funderName ?? 'Application'}</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {application.opportunityTitle ?? 'Your application'}
        </h1>
        <p className="page-sub">
          {answered} of {questions.length} questions answered · written from{' '}
          {confirmed.length} confirmed fact{confirmed.length === 1 ? '' : 's'}
          {application.deadline ? ` · deadline ${application.deadline}` : null}
        </p>
      </header>

      {/* An application with no questions in it can do nothing at all, and
          everything below assumes there are some. Leading with the readiness
          score and hiding the one available action in a collapsed row left the
          screen looking finished and inert. */}
      {questions.length === 0 ? (
        <section className="card">
          <h2 className="card-title">Start by pasting the funder’s questions</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Copy them straight out of their form or portal — all of them at once is fine. We
            split them up, pick out the word limits, and show you what we found before
            anything is saved, so a misparse costs an edit rather than a wrong draft.
          </p>
          <p className="card-sub" style={{ marginTop: 'var(--s-3)' }}>
            Until they are in, we cannot say how long this will take you or what it is worth
            per hour — the length of the answers is what decides both.
          </p>
        </section>
      ) : null}

      <section className="card">
        <div className="row-between" style={{ alignItems: 'center' }}>
          <div>
            <h2 className="card-title">Readiness — {readiness.percent}%</h2>
            <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
              How complete this is, not how likely it is to win.
            </p>
          </div>
          <span className="metric-value">{readiness.percent}%</span>
        </div>
        {readiness.blockers.length > 0 ? (
          <ul className="blockers">
            {readiness.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : null}
      </section>

      {confirmed.length === 0 ? (
        <section className="card">
          <h2 className="card-title">Nothing to write from yet</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Drafting uses only facts you have confirmed, so that no application rests on
            something unchecked.{' '}
            <a href="/organisation">Check your organisation’s details</a> and come back.
          </p>
        </section>
      ) : null}

      <PasteQuestions applicationId={application.id} open={questions.length === 0} />

      <Workspace applicationId={application.id} questions={questions} />

      <BudgetPanel
        amountRequestedGbp={application.amountRequestedGbp}
        applicationId={application.id}
        known={funderRules.known}
        lines={budgetLines}
        unknown={funderRules.unknown}
        validation={budget}
      />

      <OutcomesPanel applicationId={application.id} outcomes={outcomes} />

      {questions.length === 0 ? null : <ReviewPanel applicationId={application.id} />}

      {answered > 0 ? (
        <section className="card">
          <h2 className="card-title">Take it to the funder’s form</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Every answered question, as plain text, in order. Useful for a colleague to read
            through before you paste each answer into the portal.
          </p>
          <div className="row" style={{ marginTop: 'var(--s-4)' }}>
            <CopyButton
              text={wholeApplication}
              label={`Copy all ${answered} answers`}
              unsupportedCount={unsupported}
              variant="primary"
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}
