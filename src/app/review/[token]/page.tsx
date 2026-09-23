import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getDatabase, withAdmin } from '@/db';
import { recordShareView, resolveShare } from '@/db/shares';
import { recordAudit } from '@/db/audit';
import { loadApplication, loadClaimRefs, loadFacts } from '@/db/workspace';
import { loadComments } from '@/db/comments';
import { loadCriteria, loadOrganisation, loadProject } from '@/db/queries';
import { evaluateEligibility } from '@/domain/eligibility/engine';
import { claimStanding, usableFacts, type Fact } from '@/domain/provenance/facts';
import { citedFactClaim, sentenceLabel } from '@/domain/provenance/sentence-label';
import { DraftTrace } from '@/app/applications/DraftTrace';
import { daysLeft, isNewVisit, refusalMessage } from '@/domain/review/share';
import { verdictForReviewer } from '@/domain/review/verdict';
import { readableClaim } from '@/domain/provenance/self-declared';
import { since } from '@/domain/time/since';
import type { SourceType } from '@/domain/types';

import { CommentBox, type LeftComment } from './CommentBox';

/**
 * One application, read-only, to somebody holding a link.
 *
 * ## The only page in the product with no session
 *
 * Everywhere else, `requireOrganisationId()` is the single gate: no session,
 * no organisation, no rows. A reviewer has no account, so the token has to do
 * that job — which is why exactly one query runs on the owner connection
 * (`resolveShare`, see `src/db/shares.ts`) and everything afterwards goes
 * through `withTenant` with the organisation that token named. A reviewer is
 * inside the same policy a member is; the only difference is how the
 * organisation id was established.
 *
 * ## What it shows, and why exactly this
 *
 * The roadmap's four: the answers, the evidence behind every claim, the
 * unsupported-claim flags, and the eligibility verdict. That list is not a
 * convenience — it is what makes a second reader useful rather than
 * decorative. Prose alone invites "that reads well"; prose with the fact
 * behind each sentence invites "where does that number come from", which is
 * the question an assessor will ask.
 *
 * ## What it deliberately does NOT show
 *
 * The organisation's other applications. Its fact base as a whole — only the
 * facts this application's answers actually stand on. Its documents, its
 * tracker, its other funders. And another reviewer's comments: one link
 * shows its own holder's notes and nobody else's.
 *
 * ## The one thing it can write
 *
 * A comment, attached to the question it is about — Phase 9 Step 2's third
 * bullet, and the whole reason to show somebody the application rather than
 * email them a PDF. It is bounded in three places (the text and the
 * fifty-per-link cap in `checkComment`, the length again in the column), so
 * that a leaked link is a nuisance somebody withdraws rather than a way to
 * fill an application with a pasted document. Every comment is audited, and
 * the standing is checked on the WRITE as well as on the read: a page left
 * open for an hour must not outlive the link that drew it.
 *
 * ## Why every load is a write
 *
 * The share is lawful because it is audited, so reading it records that it
 * was read — on the share row every time, and in the audit trail once per
 * visit (`isNewVisit`). The applicant can see that their reviewer opened it,
 * which is the other half of the bargain: they are told what happened to
 * their data.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'An application, shared for review',
  // A URL holding somebody's funding application has no business in a search
  // index. Belt and braces with the header middleware sets.
  robots: { index: false, follow: false },
};

/** Sources, named for a reader who is not the applicant. */
const SOURCE_LABEL: Record<SourceType, string> = {
  companies_house: 'Companies House',
  document: 'One of their documents',
  user: 'They told us',
  ai_extraction: 'Read from one of their documents',
  '360giving': '360Giving',
  funder_published: 'The funder',
};

const money = (amount: number): string =>
  `£${amount.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

function Refusal({ message }: { message: string }) {
  return (
    <div className="page page-narrow">
      <section className="card" style={{ marginTop: 'var(--s-7)' }}>
        <h1 className="card-title">This link no longer works</h1>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          {message}
        </p>
        {/* Says nothing about whose application it was or what it was for.
            Whoever is holding a dead link may not be the person it was sent
            to — see `refusalMessage`. */}
      </section>
    </div>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const now = new Date();

  // THE ONE OWNER-CONNECTION READ. It returns the organisation, the
  // application and the standing, and nothing about either.
  const share = await withAdmin((tx) => resolveShare(tx, token, now));

  // A token nobody ever issued gets the same answer as a URL that was never a
  // page: nothing, with no hint that a different token would have worked.
  if (share === null) notFound();
  if (share.standing !== 'live') return <Refusal message={refusalMessage(share.standing)} />;

  const database = await getDatabase();
  const page = await database.withTenant(share.organisationId, async (tx) => {
    const application = await loadApplication(tx, share.applicationId);
    if (application === null) return null;

    // Counted first, so a reader who abandons the page half-loaded is still a
    // reader. `previousViewAt` is the value this write destroys, which is why
    // the write returns it rather than the caller reading it afterwards.
    const visit = await recordShareView(tx, share.id);

    const facts = await loadFacts(tx);
    const organisation = await loadOrganisation(tx);
    const project = await loadProject(tx);
    const criteria =
      application.opportunityId === null
        ? []
        : (await loadCriteria(tx, application.opportunityId)).criteria;

    // This reviewer's own notes, by share rather than by application: one
    // reviewer has no business reading another's.
    const comments = await loadComments(tx, share.applicationId, { shareId: share.id });

    const questions = [];
    for (const question of application.questions) {
      const answer = application.answers.get(question.id) ?? null;
      const claims =
        answer === null
          ? []
          : (await loadClaimRefs(tx, question.id)).map((claim) => ({
              text: claim.claimText,
              factId: claim.factId,
              standing: claimStanding(claim.factId, facts),
              label: sentenceLabel(
                claimStanding(claim.factId, facts),
                citedFactClaim(claim.factId, facts),
              ),
            }));
      questions.push({
        id: question.id,
        position: question.position,
        question: question.question,
        wordLimit: question.word_limit,
        answer: answer?.content ?? null,
        wordCount: answer?.word_count ?? 0,
        claims,
      });
    }

    // ONE LINE PER VISIT, not per load — see `isNewVisit`. Written inside the
    // tenant transaction like every other audit line, with no user id: a
    // reviewer is not a user of this organisation, and attributing their read
    // to whoever created the link would be a false record.
    if (isNewVisit(visit.previousViewAt, now)) {
      await recordAudit(tx, share.organisationId, {
        userId: null,
        action: 'share.viewed',
        entityId: share.id,
        applicationId: share.applicationId,
        metadata: { reviewerName: share.reviewerName, visit: visit.views },
      });
    }

    return { application, facts, organisation, project, criteria, questions, comments };
  });

  if (page === null) notFound();
  const { application, facts, organisation, project, criteria, questions, comments } = page;

  // ONE clock reading for every relative time on this page, phrased here
  // rather than inside the client component: a clock read during render gives
  // one answer in the server's HTML and another on hydration, which is React
  // #418 and a discarded tree.
  const clock = now.getTime();
  const commentsFor = (questionId: string | null): LeftComment[] =>
    comments
      .filter((comment) => comment.questionId === questionId)
      .map((comment) => ({
        id: comment.id,
        body: comment.body,
        when: since(comment.createdAt, clock),
        handled: comment.handledAt !== null,
      }));

  const confirmed = usableFacts(facts);
  const byId = new Map<string, Fact>();
  for (const fact of confirmed) {
    byId.set(fact.id, fact);
    // A claim ref may name either the fact's id or its claim key — see
    // `claimStanding`, which accepts both.
    if (!byId.has(fact.claim)) byId.set(fact.claim, fact);
  }

  const answered = questions.filter((q) => q.answer !== null && q.answer !== '');
  const unsupportedTotal = questions.reduce(
    (total, q) => total + q.claims.filter((claim) => claim.standing === 'unsupported').length,
    0,
  );

  const applicantKnown = organisation !== null && project !== null;
  const eligibility =
    organisation === null || project === null
      ? { verdict: 'unknown' as const, checked: 0, undecided: 0, applicantKnown }
      : (() => {
          const asked = application.amountRequestedGbp ?? project.amountSoughtGbp;
          const evaluated = evaluateEligibility(
            organisation.profile,
            { ...project, amountSoughtGbp: asked },
            criteria,
            { asOf: now.toISOString().slice(0, 10) },
          );
          return {
            verdict: evaluated.verdict,
            checked: evaluated.results.length,
            undecided: evaluated.unknowns.length,
            applicantKnown,
          };
        })();
  const verdict = verdictForReviewer(eligibility);

  const left = daysLeft({ expiresAt: share.expiresAt, revokedAt: null }, now);

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Shared with you for review</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {application.opportunityTitle ?? 'A funding application'}
        </h1>
        <p className="page-sub">
          {organisation === null ? 'An organisation' : organisation.name}
          {application.funderName === null ? null : ` · applying to ${application.funderName}`}
          {application.amountRequestedGbp === null
            ? null
            : ` · for ${money(application.amountRequestedGbp)}`}
          {application.deadline === null ? null : ` · deadline ${application.deadline}`}
        </p>
      </header>

      {/* What this page is and what it is not, before anything else. Somebody
          arriving from an email does not know whether they are expected to
          edit it, and a read-only page with no note saying so is how a
          reviewer spends ten minutes looking for a comment box. */}
      <section className="card">
        <h2 className="card-title">You are reading, not editing</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          This link was made for {share.reviewerName} by whoever is writing the
          application. You cannot change a word of it — but you can leave a comment under
          any answer, and they will see it beside the words it is about. The link stops
          working in {left} day{left === 1 ? '' : 's'}, or as soon as they withdraw it.
        </p>
        <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
          They are told that you opened it, and when. That is the deal that makes showing
          you their organisation’s own record a fair one.
        </p>
      </section>

      {/* THE VERDICT. First of the substantive cards, because "are they even
          allowed to apply" is worth more than any amount of prose polish. */}
      <section className="card">
        <div className="row-between" style={{ alignItems: 'center' }}>
          <div>
            <h2 className="card-title">Can they apply for this?</h2>
            <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
              {verdict.detail}
            </p>
          </div>
          <span
            className={
              verdict.tone === 'positive'
                ? 'badge badge-positive'
                : verdict.tone === 'negative'
                  ? 'badge badge-negative'
                  : 'badge badge-neutral'
            }
          >
            {verdict.label}
          </span>
        </div>
      </section>

      {/* THE FLAG, once and at the top, and again beside the sentence it is
          about. A reviewer who reads six good answers and then finds the
          warning at the bottom has read them all in the wrong frame. */}
      {unsupportedTotal > 0 ? (
        <section className="card">
          <h2 className="card-title">
            {unsupportedTotal} sentence{unsupportedTotal === 1 ? '' : 's'} with nothing behind
            {unsupportedTotal === 1 ? ' it' : ' them'}
          </h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Highlighted below. Every other sentence is traced to something this organisation
            has confirmed, and the source is listed under each answer. These are the ones
            that are not — worth asking about, because an assessor will.
          </p>
        </section>
      ) : null}

      {answered.length === 0 ? (
        <section className="card">
          <h2 className="card-title">Nothing written yet</h2>
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            The questions are in but no answer has been written. Worth coming back to the
            same link — it stays live for {left} more day{left === 1 ? '' : 's'}.
          </p>
        </section>
      ) : null}

      {answered.map((question) => {
        const unsupported = question.claims.filter(
          (claim) => claim.standing === 'unsupported',
        ).length;
        // The facts this ONE answer stands on, in the order the sentences
        // used them and each named once. Not the organisation's fact base:
        // a reviewer is shown the evidence behind what they are reading and
        // no more.
        const evidence: Fact[] = [];
        for (const claim of question.claims) {
          if (claim.standing !== 'supported' || claim.factId === null) continue;
          const fact = byId.get(claim.factId);
          if (fact !== undefined && !evidence.some((seen) => seen.id === fact.id)) {
            evidence.push(fact);
          }
        }

        return (
          <section className="card" key={question.id}>
            <h2 className="card-title">
              {question.position}. {question.question}
            </h2>
            <p className="card-sub" style={{ marginTop: 'var(--s-1)' }}>
              {question.wordCount} word{question.wordCount === 1 ? '' : 's'}
              {question.wordLimit === null ? null : ` of ${question.wordLimit} allowed`}
              {question.wordLimit !== null && question.wordCount > question.wordLimit
                ? ' — over the limit'
                : null}
            </p>

            {/* The prose, sentence by sentence where we have that breakdown,
                so an unsupported claim can be marked in place rather than
                described in a footnote. An answer the applicant typed
                themselves has no breakdown, and then it is shown whole. */}
            {question.claims.length > 0 ? (
              <DraftTrace
                heading="What each sentence stands on"
                sentences={question.claims.map((claim) => ({
                  text: claim.text,
                  label: claim.label,
                }))}
              />
            ) : (
              <div className="answer" style={{ marginTop: 'var(--s-4)' }}>
                {question.answer}
              </div>
            )}

            {unsupported > 0 ? (
              <p className="notice notice-caution" style={{ marginTop: 'var(--s-3)' }}>
                <span aria-hidden="true">⚠</span>
                <span>
                  {unsupported === 1
                    ? 'One sentence has no confirmed fact behind it.'
                    : `${unsupported} sentences have no confirmed fact behind them.`}{' '}
                  Either evidence or remove, before this goes anywhere.
                </span>
              </p>
            ) : null}

            {evidence.length > 0 ? (
              <>
                <h3 className="part-head">What this answer stands on</h3>
                <ul className="evidence">
                  {evidence.map((fact) => (
                    <li key={fact.id}>
                      <span className="evidence-claim">{readableClaim(fact.claim)}</span>
                      <span className="evidence-value">{fact.value}</span>
                      <span className="evidence-source">
                        {SOURCE_LABEL[fact.sourceType] ?? fact.sourceType}
                        {fact.confirmedAt === null ? ' · not confirmed' : ' · confirmed'}
                      </span>
                      {fact.sourceSpan === null ? null : (
                        <span className="evidence-span">“{fact.sourceSpan}”</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            ) : question.claims.length > 0 ? (
              <p className="hint" style={{ marginTop: 'var(--s-3)' }}>
                No source recorded for this answer — it was written by hand rather than
                drafted from their confirmed facts.
              </p>
            ) : null}

            {/* THE COMMENT BOX, under the answer it is about.
                Not one box at the foot of the page: a note written six
                answers away from its subject arrives as "the second one needs
                numbers", which is a puzzle by the time somebody reads it. */}
            <CommentBox
              comments={commentsFor(question.id)}
              heading={`Anything to say about answer ${question.position}?`}
              hint="What an assessor would ask, what is missing, what reads well."
              questionId={question.id}
              token={token}
            />
          </section>
        );
      })}

      {questions.length > answered.length ? (
        <section className="card">
          <h2 className="card-title">
            Still to write: {questions.length - answered.length} of {questions.length}
          </h2>
          <ol className="unanswered" style={{ marginTop: 'var(--s-3)' }}>
            {questions
              .filter((question) => question.answer === null || question.answer === '')
              .map((question) => (
                <li key={question.id}>
                  {question.position}. {question.question}
                </li>
              ))}
          </ol>
        </section>
      ) : null}

      {/* And one box for what belongs to no single answer — "the budget does
          not match what answer 3 promises" is about the application, and
          filing it under an arbitrary question hides it. */}
      <section className="card">
        <h2 className="card-title">Anything about the whole application?</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          The overall case, something two answers contradict, or what you would ask if you
          were assessing it.
        </p>
        <CommentBox
          comments={commentsFor(null)}
          heading="Your comment"
          hint="Something that is not about one answer in particular."
          questionId={null}
          token={token}
        />
      </section>

      <p className="hint" style={{ marginTop: 'var(--s-6)' }}>
        Shared through Grant Finder Studio. This link is for {share.reviewerName} and expires
        in {left} day{left === 1 ? '' : 's'}. Comments you leave here are recorded with your
        name as they labelled it, and they are told each time you read it.
      </p>
    </div>
  );
}
