import { notFound } from 'next/navigation';
import { getDatabase } from '@/db';
import { requireOrganisationId, requireUserId } from '@/app/session';
import { loadApplication, loadClaimRefs, loadFacts } from '@/db/workspace';
import { loadBudgetLines } from '@/db/budget';
import { loadOutcomes } from '@/db/outcomes';
import { answersEditedSince, loadLatestReview } from '@/db/reviews';
import { loadAuditTrail } from '@/db/audit';
import { loadShares } from '@/db/shares';
import { loadComments } from '@/db/comments';
import { loadCriteria, loadOrganisation, loadProject } from '@/db/queries';
import { evaluateEligibility } from '@/domain/eligibility/engine';
import { since } from '@/domain/time/since';
import { daysLeft, shareStanding } from '@/domain/review/share';
import { claimStanding, usableFacts } from '@/domain/provenance/facts';
import { citedFactClaim, sentenceLabel } from '@/domain/provenance/sentence-label';
import { assessReadiness } from '@/domain/readiness/readiness';
import { validateBudget } from '@/domain/budget/validate';
import { restrictionsFromCriteria } from '@/domain/budget/restrictions';
import { isDecision } from '@/domain/tracker/decision';
import { DECISION_BADGE, decisionLine } from '@/app/components';

import { Workspace, type QuestionView } from './Workspace';
import { PasteQuestions } from './PasteQuestions';
import { ReviewPanel } from './ReviewPanel';
import { BudgetPanel } from './BudgetPanel';
import { OutcomesPanel } from './OutcomesPanel';
import { TrailPanel } from './TrailPanel';
import { SharePanel, type ShareView } from './SharePanel';
import { CommentsPanel, type CommentView } from './CommentsPanel';
import { CopyButton } from './CopyButton';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const organisationId = await requireOrganisationId();
  const viewerId = await requireUserId();
  const database = await getDatabase();

  const page = await database.withTenant(organisationId, async (tx) => {
    const application = await loadApplication(tx, id);
    if (!application) return null;
    const facts = await loadFacts(tx);
    const budgetLines = await loadBudgetLines(tx, id);
    const outcomes = await loadOutcomes(tx, id);
    // The last review, and how much has moved under it. A finding quotes the
    // words it is about, so a review of answers since rewritten has to say so
    // rather than read as current.
    const review = await loadLatestReview(tx, id);
    const answersEdited =
      review === null ? 0 : await answersEditedSince(tx, id, review.createdAt);
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

    // The applicant's own details and their project, which the eligibility
    // engine needs and this query did not load — the reason the verdict was
    // hardcoded. Either can be null on an account that has not finished
    // onboarding, and null means no verdict rather than a default of "fine".
    const organisation = await loadOrganisation(tx);
    const project = await loadProject(tx);
    // Scoped to this application: the organisation's own events — a fact
    // confirmed, a document uploaded — belong to the organisation and not to
    // whatever application happens to be open.
    const trail = await loadAuditTrail(tx, organisationId, { applicationId: id });
    // Every link ever made for this application, live or not. The withdrawn
    // ones are the applicant's record of who had access and when it stopped,
    // so the panel lists them rather than hiding them.
    const shares = await loadShares(tx, id);
    // Every reviewer's comments, unlike the reviewer's own page which sees
    // only the ones left through its own link. These are the applicant's.
    const comments = await loadComments(tx, id);

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
              label: sentenceLabel(
                claimStanding(c.factId, facts),
                citedFactClaim(c.factId, facts),
              ),
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
    return {
      application, facts, questions, budgetLines, outcomes, criteria, review,
      answersEdited, organisation, project, trail, shares, comments,
    };
  });

  if (!page) notFound();
  const {
    application, facts, questions, budgetLines, outcomes, criteria, review,
    answersEdited, organisation, project, trail, shares, comments,
  } = page;

  // ONE clock reading, here, for every relative time on this page. Read while
  // rendering a client component it gives a different answer in the server's
  // HTML than on hydration, which is React #418 and a discarded tree — the
  // fault `ReviewPanel` shipped with.
  const now = Date.now();
  const whenByRow = Object.fromEntries(trail.map((row) => [row.id, since(row.createdAt, now)]));

  // The share panel is a client component, so every relative time it shows is
  // phrased here, off the same one clock reading — the rule `TrailPanel`
  // explains, applied to the other panel that talks about the past.
  const shareViews: ShareView[] = shares.map((share) => {
    const state = { expiresAt: share.expiresAt, revokedAt: share.revokedAt };
    return {
      id: share.id,
      reviewerName: share.reviewerName,
      standing: shareStanding(state, new Date(now)),
      daysLeft: daysLeft(state, new Date(now)),
      views: share.views,
      firstViewed: share.firstViewedAt === null ? null : since(share.firstViewedAt, now),
      lastViewed: share.lastViewedAt === null ? null : since(share.lastViewedAt, now),
      created: since(share.createdAt, now),
    };
  });

  // The question each comment is about, by id, so the panel can name it. The
  // comment carries the id; the question text is here.
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const commentViews: CommentView[] = comments.map((comment) => {
    const question = comment.questionId === null ? null : questionById.get(comment.questionId);
    return {
      id: comment.id,
      body: comment.body,
      reviewerName: comment.reviewerName,
      when: since(comment.createdAt, now),
      handled: comment.handledAt !== null,
      questionNumber: question?.position ?? null,
      questionText: question?.question ?? null,
    };
  });

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

  /**
   * Eligibility, evaluated rather than assumed.
   *
   * This was hardcoded — `'eligible'` first, so the card claimed "you meet
   * every criterion we can check" on every application ever opened whatever
   * the engine thought, and then `'unknown'`, which was honest and told
   * nobody anything. The engine has been here all along; what was missing was
   * the applicant profile and the project, which this query now loads.
   *
   * THE AMOUNT CHECKED IS THIS APPLICATION'S, not the project's.
   * `amountRequestedGbp` is what is being asked of THIS funder, and an
   * amount-limit criterion is a rule about that number. The project's own
   * figure is the fallback for an application that has not named one yet.
   */
  const applicantKnown = organisation !== null && project !== null;
  const eligibility =
    organisation === null || project === null
      ? { verdict: 'unknown' as const, checked: 0, undecided: 0, applicantKnown }
      : (() => {
          const asked = application.amountRequestedGbp ?? project.amountSoughtGbp;
          const verdict = evaluateEligibility(
            organisation.profile,
            { ...project, amountSoughtGbp: asked },
            criteria,
            { asOf: new Date().toISOString().slice(0, 10) },
          );
          return {
            verdict: verdict.verdict,
            checked: verdict.results.length,
            undecided: verdict.unknowns.length,
            applicantKnown,
          };
        })();

  const readiness = assessReadiness({
    eligibility,
    questionsTotal: questions.length,
    questionsAnswered: answered,
    answersWithUnsupportedClaims: unsupported,
    evidenceNeeded: 0,
    evidenceProvided: 0,
    budgetSubmittable: budget.isSubmittable,
    budgetHasLines: budgetLines.length > 0,
    budgetRulesChecked: funderRules.known.length > 0,
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

      {/* THE ANSWER, ABOVE THE READINESS CARD.
          Opening a funded application and being told it is 83% ready to
          submit is the product not knowing something the user told it. The
          readiness card still stands — it is a record of how complete the
          thing was — but it cannot be the first thing on the page once the
          funder has spoken. */}
      {isDecision(application.status) ? (
        <section className="card" style={{ marginBottom: 'var(--s-5)' }}>
          <div className="row-between" style={{ alignItems: 'center' }}>
            <div>
              <h2 className="card-title">
                {decisionLine({
                  decision: application.status,
                  decidedOn: application.decidedOn,
                  amountAwardedGbp: application.amountAwardedGbp,
                  amountRequestedGbp: application.amountRequestedGbp,
                })}
              </h2>
              <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
                Recorded by you on the tracker, where it can also be corrected.
              </p>
            </div>
            <span className={DECISION_BADGE[application.status].className}>
              <span aria-hidden="true">{DECISION_BADGE[application.status].mark}</span>
              {DECISION_BADGE[application.status].label}
            </span>
          </div>
          {application.outcomeNote === null ? null : (
            <blockquote className="decision-note">{application.outcomeNote}</blockquote>
          )}
        </section>
      ) : null}

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
            {/* A green 100% beside an eligibility check nobody could run read
                as "good to go" for a fund with no rules on record — found on
                the September 2026 walk. The number stays; it just does not
                stand alone. */}
            {readiness.components.find((c) => c.id === 'eligibility')?.score === null ? (
              <p className="notice notice-caution" style={{ marginTop: 'var(--s-2)' }}>
                <span aria-hidden="true">⚠</span>
                <span>
                  This does not include eligibility.{' '}
                  {readiness.components.find((c) => c.id === 'eligibility')?.detail} Whether
                  you can apply at all is still for you to check with the funder.
                </span>
              </p>
            ) : null}
          </div>
          <span className="metric-value">{readiness.percent}%</span>
        </div>

        {/* THE BREAKDOWN.
            The engine has always returned seven components, each with its own
            score and its own sentence about what to do next, and the card
            showed the average and nothing else. So a number moved and there
            was no way to see what had moved it, and the blockers list — which
            only carries the things that would stop submission — was doing the
            explaining for parts that are merely incomplete.

            The score is text as well as a bar, so the bar is decorative. */}
        <ul className="parts">
          {readiness.components.map((part) => {
            const pct = part.score === null ? null : Math.round(part.score * 100);
            return (
              <li className="part" key={part.id}>
                <span className="part-label">{part.label}</span>
                {/* NO BAR AT ALL for a part that is not counted.
                    There was one, drawn empty, and the first screenshot showed
                    why that is wrong: an empty track beside the words "not
                    counted" reads as nought per cent, which is the exact
                    distinction this card exists to make. A part nobody can
                    measure and a part with nothing in it are different
                    things. */}
                {pct === null ? null : (
                  <span
                    aria-hidden="true"
                    className={pct === 0 ? 'part-meter part-empty' : 'part-meter'}
                  >
                    <span
                      className={pct === 100 ? 'part-fill part-done' : 'part-fill part-part'}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                )}
                <span className={pct === null ? 'part-score part-skip' : 'part-score'}>
                  {pct === null ? 'Not counted' : `${pct}%`}
                </span>
                <span className="part-detail">{part.detail}</span>
              </li>
            );
          })}
        </ul>
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          {/* Which parts the number came from. A component that does not apply
              is left out of the average rather than scored zero — an
              application needing no attachments is not behind for having
              none — and a percentage that quietly averages a different set
              each time needs to say so. */}
          Averaged over the {readiness.counted} of {readiness.components.length} parts that
          apply to this application.
        </p>

        {readiness.blockers.length > 0 ? (
          <>
            {/* A HEADING, because the breakdown above says several of these
                things already. Three sentences floating under the parts read
                as the same facts twice; under a heading they are a different
                claim — the parts say how far along each one is, this says
                which of them would stop the application being sent. */}
            <h3 className="part-head">What would stop you submitting</h3>
            <ul className="blockers">
              {readiness.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* HIGH, because a comment is somebody waiting on you rather than a
          reference. Under the readiness card so the first two things on the
          screen are "how far along is this" and "what has a person told you
          about it". It renders nothing at all when there are no comments. */}
      <CommentsPanel applicationId={application.id} comments={commentViews} />

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

      {questions.length === 0 ? null : (
        <ReviewPanel
          answersEdited={answersEdited}
          applicationId={application.id}
          readinessPercent={readiness.percent}
          stored={review}
          storedWhen={review === null ? null : since(review.createdAt, now)}
        />
      )}

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

      {/* Folded away like the trail, and for the same reason: it is something
          you do once, not something you read while writing. Below the copy
          button deliberately — showing it to a colleague and pasting it into
          the portal are the two ways an application leaves here, and they
          belong next to each other. */}
      <SharePanel
        answered={answered}
        applicationId={application.id}
        shares={shareViews}
      />

      {/* Last, and folded away. A history is a reference rather than a task,
          and forty lines of it above the answer boxes would be the page
          talking about itself instead of letting somebody work. */}
      <TrailPanel trail={trail} viewerId={viewerId} whenByRow={whenByRow} />
    </div>
  );
}
