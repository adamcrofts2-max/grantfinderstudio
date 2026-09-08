import { notFound } from 'next/navigation';
import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadApplication, loadClaimRefs, loadFacts } from '@/db/workspace';
import { usableFacts } from '@/domain/provenance/facts';
import { assessReadiness } from '@/domain/readiness/readiness';

import { Workspace, type QuestionView } from './Workspace';
import { PasteQuestions } from './PasteQuestions';
import { ReviewPanel } from './ReviewPanel';
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
          ? (await loadClaimRefs(tx, q.id)).map((c) => ({ text: c.claimText, factId: c.factId }))
          : [],
      });
    }
    return { application, facts, questions };
  });

  if (!page) notFound();
  const { application, facts, questions } = page;

  const confirmed = usableFacts(facts);
  const answered = questions.filter((q) => q.answer !== null && q.answer !== '').length;
  const unsupported = questions.filter((q) => q.claims.some((c) => c.factId === null)).length;
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

  const readiness = assessReadiness({
    eligibilityVerdict: 'eligible',
    questionsTotal: questions.length,
    questionsAnswered: answered,
    answersWithUnsupportedClaims: unsupported,
    evidenceNeeded: 0,
    evidenceProvided: 0,
    budgetSubmittable: false,
    budgetHasLines: false,
    outcomesDefined: 0,
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

      <PasteQuestions applicationId={application.id} />

      <Workspace applicationId={application.id} questions={questions} />

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
