import { withOperator } from '@/db';
import { readFunderHoldings } from '@/db/awards';
import { MIN_AWARDS_TO_CHARACTERISE } from '@/domain/funder/behaviour';

import { requireAdmin } from '../session';
import { AdminShell } from '../AdminShell';
import { IngestForm } from './IngestForm';
import { removeFunderAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

/**
 * Funder discovery, from the operator's side.
 *
 * The connector, the normaliser, the behaviour summary, the prospect matcher
 * and the `/funders` screen were all finished before this existed — and none
 * of them had a row to work on, because nothing wrote one. This is the page
 * that fills the table.
 */
export default async function AdminFundersPage() {
  const session = await requireAdmin();

  let holdings: Awaited<ReturnType<typeof readFunderHoldings>> = [];
  let error: string | null = null;
  try {
    holdings = await withOperator((tx) => readFunderHoldings(tx));
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const characterised = holdings.filter((h) => h.awardCount >= MIN_AWARDS_TO_CHARACTERISE);
  const totalAwards = holdings.reduce((sum, h) => sum + h.awardCount, 0);

  return (
    <AdminShell email={session.email} active="funders">
      <section className="card">
        <h2 className="card-title">Load a funder from 360Giving</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Awarded grants, not open calls. This is what lets the product answer “who has
          actually funded work like ours” — a funder needs at least{' '}
          {MIN_AWARDS_TO_CHARACTERISE} published grants before we will describe them at all.
        </p>
        <div style={{ marginTop: 'var(--s-5)' }}>
          <IngestForm />
        </div>
      </section>

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">
          Loaded — {holdings.length} funder{holdings.length === 1 ? '' : 's'}, {totalAwards} grants
        </h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          {characterised.length} of them have enough published grants to be described to an
          applicant. The rest appear as “too little published to say”.
        </p>

        {error !== null ? (
          <p className="notice notice-caution" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : holdings.length === 0 ? (
          <p className="card-sub" style={{ marginTop: 'var(--s-4)' }}>
            Nothing yet. Until a funder is loaded, every organisation’s “who funds work like
            yours” screen is empty.
          </p>
        ) : (
          <ul className="admin-list" style={{ marginTop: 'var(--s-4)' }}>
            {holdings.map((holding) => (
              <li className="admin-list-item" key={holding.id}>
                <div style={{ minWidth: 0 }}>
                  <p className="admin-list-title">{holding.name}</p>
                  <p className="hint">
                    {holding.awardCount} grant{holding.awardCount === 1 ? '' : 's'}
                    {holding.mostRecentAward === null
                      ? ' · none dated'
                      : ` · most recent ${holding.mostRecentAward}`}
                    {holding.awardCount < MIN_AWARDS_TO_CHARACTERISE
                      ? ' · too few to describe'
                      : ''}
                  </p>
                  {holding.attribution === null ? null : (
                    <p className="hint">{holding.attribution}</p>
                  )}
                </div>
                <form action={removeFunderAction}>
                  <input type="hidden" name="id" value={holding.id} />
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
