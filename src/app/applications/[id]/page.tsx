import { notFound } from 'next/navigation';
import { getDatabase } from '@/db';
import { loadApplication, loadClaimRefs, loadFacts } from '@/db/workspace';
import { usableFacts } from '@/domain/provenance/facts';
import { assessReadiness } from '@/domain/readiness/readiness';
import { DEMO_ORG_ID } from '@/demo/seed';
import { Workspace, type QuestionView } from './Workspace';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const database = await getDatabase();

  const page = await database.withTenant(DEMO_ORG_ID, async (tx) => {
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

      <Workspace applicationId={application.id} questions={questions} />
    </div>
  );
}
