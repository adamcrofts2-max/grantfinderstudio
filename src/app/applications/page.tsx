import { EmptyState } from '@/app/illustration/EmptyState';
import { getDatabase } from '@/db';
import { requireOrganisationId } from '@/app/session';
import { loadApplications } from '@/db/workspace';

import { gbp } from '@/app/components';

export const dynamic = 'force-dynamic';

/** Deadlines only mean something alongside how confident we are in them. */
function deadlineNote(deadline: string | null, kind: string | null): string {
  if (deadline === null) {
    return kind === 'rolling' ? 'Rolling deadline' : 'No deadline recorded';
  }
  if (kind === 'confirmed') return `Due ${deadline}`;
  if (kind === 'estimated') return `${deadline} — our estimate, not published`;
  if (kind === 'expected') return `${deadline} — expected, not confirmed`;
  return `Due ${deadline}`;
}

export default async function ApplicationsPage() {
  const organisationId = await requireOrganisationId();
  const database = await getDatabase();
  const applications = await database.withTenant(organisationId, (tx) => loadApplications(tx));

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Applications</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          What you have on the go
        </h1>
        <p className="page-sub">
          Ordered by deadline. Start a new one from any opportunity.
        </p>
      </header>

      {applications.length === 0 ? (
        <EmptyState
          title="Nothing started yet"
          action={<a className="btn btn-primary" href="/">See your opportunities</a>}
        >
          Open an opportunity and choose <strong>Start an application</strong>. You can then paste
          the funder’s questions straight in.
        </EmptyState>
      ) : null}

      {applications.map((application) => (
        <a className="opportunity" key={application.id} href={`/applications/${application.id}`}>
          <section className="card">
            <div className="row-between">
              <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
                <h2 className="opportunity-title">
                  {application.opportunityTitle ?? 'Untitled application'}
                </h2>
                <p className="opportunity-funder">{application.funderName ?? 'Unknown funder'}</p>
                <p className="headline">
                  {application.questions === 0
                    ? 'No questions yet — paste them from the funder’s form'
                    : `${application.answered} of ${application.questions} questions answered`}
                  {application.amountRequestedGbp === null
                    ? null
                    : ` · ${gbp(application.amountRequestedGbp)}`}
                </p>
                <p className="criteria-why" style={{ marginTop: 'var(--s-1)' }}>
                  {deadlineNote(application.deadline, application.deadlineKind)}
                </p>
              </div>
              <div className="metric">
                {application.unsupported > 0 ? (
                  <span className="badge badge-caution">
                    <span aria-hidden="true">⚠</span>
                    {application.unsupported} unsupported
                  </span>
                ) : application.answered > 0 && application.answered === application.questions ? (
                  <span className="badge badge-positive">
                    <span aria-hidden="true">✓</span>All answered
                  </span>
                ) : (
                  <span className="badge badge-neutral">{application.status}</span>
                )}
              </div>
            </div>
          </section>
        </a>
      ))}
    </div>
  );
}
