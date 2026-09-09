import { withOperator } from '@/db';
import { readSharedFunds } from '@/db/platform';
import { gbp } from '@/app/components';
import { ManualFundForm } from '@/app/ManualFundForm';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';
import { addSharedFundAction, removeSharedFundAction } from './actions';
import { EMPTY_CATALOGUE_FORM } from './state';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

const DEADLINE_NOTE: Record<string, string> = {
  confirmed: 'published by the funder',
  expected: 'expected',
  estimated: 'our estimate',
  rolling: 'rolling — no closing date',
  unknown: 'closing date unknown',
};

function size(min: number | null, max: number | null): string {
  if (min === null && max === null) return 'Size not recorded';
  if (min !== null && max !== null) return `${gbp(min)} – ${gbp(max)}`;
  if (max !== null) return `Up to ${gbp(max)}`;
  return `From ${gbp(min ?? 0)}`;
}

/**
 * The shared catalogue.
 *
 * This is the answer to a deployment with no model key. Nothing here reads
 * guidance for anybody: an operator who has looked at a funder's page types
 * six fields, and every organisation on the deployment can see the fund from
 * then on. A hand-entered fund carries no eligibility criteria and does not
 * pretend to — its eligibility reads `unknown`, which is honest, and a CIC can
 * still see the deadline, the size and the link.
 */
export default async function AdminCataloguePage() {
  const session = await requireAdmin();

  let funds: Awaited<ReturnType<typeof readSharedFunds>> = [];
  let error: string | null = null;
  try {
    funds = await withOperator((tx) => readSharedFunds(tx));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  return (
    <AdminShell email={session.email} active="catalogue">
      <section className="card">
        <h2 className="card-title">Add a fund everybody can see</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Read the funder’s own page and type what it says. This needs no API key, and it is
          what turns an empty deployment into one worth signing up to. Added funds are marked{' '}
          <strong>needs verification</strong> — nothing here knows whether the page is still
          current.
        </p>
        <div style={{ marginTop: 'var(--s-5)' }}>
          <ManualFundForm
            action={addSharedFundAction}
            submitLabel="Add to the catalogue"
            initial={EMPTY_CATALOGUE_FORM}
          />
        </div>
      </section>

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">In the catalogue — {funds.length}</h2>
        {error !== null ? (
          <p className="notice notice-caution" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : funds.length === 0 ? (
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Nothing yet. Until there is, every new account opens on an empty list and has to
            bring its own funds.
          </p>
        ) : (
          <ul className="admin-list">
            {funds.map((fund) => (
              <li className="admin-list-item" key={fund.id}>
                <div style={{ minWidth: 0 }}>
                  <p className="admin-list-title">{fund.title}</p>
                  <p className="hint">{fund.funderName}</p>
                  <p className="hint">
                    {size(fund.minAmountGbp, fund.maxAmountGbp)}
                    {' · '}
                    {fund.deadline === null
                      ? (DEADLINE_NOTE[fund.deadlineKind] ?? fund.deadlineKind)
                      : `${fund.deadline.toISOString().slice(0, 10)} (${DEADLINE_NOTE[fund.deadlineKind] ?? fund.deadlineKind})`}
                  </p>
                  {fund.sourceUrl === null ? null : (
                    <p className="hint">
                      <a href={fund.sourceUrl} rel="noreferrer noopener" target="_blank">
                        {fund.sourceUrl}
                      </a>
                    </p>
                  )}
                </div>
                <form action={removeSharedFundAction}>
                  <input type="hidden" name="id" value={fund.id} />
                  <button className="btn btn-secondary btn-small" type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
