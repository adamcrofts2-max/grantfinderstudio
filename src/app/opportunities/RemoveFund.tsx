import { deleteOpportunityAction } from '@/app/opportunities/add/actions';

/**
 * Removing a fund you added, behind one deliberate step.
 *
 * It was a bare button at the foot of the review screen: one click, no
 * question, and gone — along with any application started against it, because
 * applications cascade from their fund. The fund is easy to add again. The
 * application's answers are the person's own writing and are not.
 *
 * So it is folded away, it says exactly what goes with it, and when an
 * application would go too it asks for that to be ticked — checked again on
 * the server, since a form field is only a request.
 */
export function RemoveFund({
  opportunityId,
  title,
  application,
}: {
  opportunityId: string;
  title: string;
  application: { answered: number; total: number } | null;
}) {
  return (
    <details className="card paste danger" id="remove">
      <summary className="paste-summary">
        Remove this fund
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>
      <form className="paste-body" action={deleteOpportunityAction}>
        <input type="hidden" name="opportunityId" value={opportunityId} />
        <p className="card-sub">
          {application === null
            ? `“${title}” comes off your list, with the rules you added for it. You can add it again at any time.`
            : `“${title}” comes off your list, with its rules — and your application for it goes too: ${application.answered} of ${application.total} ${application.total === 1 ? 'question' : 'questions'} answered. That cannot be undone.`}
        </p>
        {application === null ? null : (
          <label className="rule-choice" style={{ marginTop: 'var(--s-3)' }}>
            <input type="checkbox" name="alsoApplication" value="yes" required />
            Remove my application and its answers as well
          </label>
        )}
        <button className="btn btn-destructive" type="submit" style={{ marginTop: 'var(--s-4)' }}>
          {application === null ? 'Remove the fund' : 'Remove the fund and its application'}
        </button>
      </form>
    </details>
  );
}
