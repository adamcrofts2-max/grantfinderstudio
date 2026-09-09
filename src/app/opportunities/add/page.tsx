import { isWriterAvailable } from '@/app/drafting';
import { EMPTY_MANUAL_FUND, ManualFundForm } from '@/app/ManualFundForm';

import { AddOpportunity } from './AddOpportunity';
import { addOwnFundAction } from './manual-actions';

export const dynamic = 'force-dynamic';

export default async function AddOpportunityPage() {
  const writerAvailable = await isWriterAvailable();

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Add a fund</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Bring us the fund you are looking at
        </h1>
        <p className="page-sub">
          There is no public register of what UK trusts and foundations have open. Government’s
          own list carries around 120 grants and no trusts at all; the big commercial databases
          are compiled by researchers, by hand. So rather than pretend to a database we do not
          have, we take the fund from you — either by reading the funder’s page with you, or by
          your typing the few things that matter.
        </p>
      </header>

      {/* Two routes, and which one leads depends on what this deployment can
          actually do. Leading with the reader where there is no key is how you
          hand somebody a form that cannot work; leading with the form where
          there IS one hides the better path. */}
      {writerAvailable ? (
        <>
          <AddOpportunity ready />
          <details className="card" id="by-hand" style={{ marginTop: 'var(--s-5)' }}>
            <summary className="paste-summary">
              <span>Or type it in yourself</span>
              <span className="chev chev-toggle" aria-hidden="true" />
            </summary>
            <div className="paste-body">
              <p className="card-sub">
                Quicker when you already know the deadline and the size, and it needs nothing
                from us. A fund entered this way carries no eligibility rules — we would be
                inventing them — so it shows as <strong>unknown</strong> rather than as
                checked.
              </p>
              <div style={{ marginTop: 'var(--s-5)' }}>
                <ManualFundForm
                  action={addOwnFundAction}
                  submitLabel="Add this fund"
                  initial={EMPTY_MANUAL_FUND}
                />
              </div>
            </div>
          </details>
        </>
      ) : (
        <>
          <section className="card">
            <h2 className="card-title">Type in what the funder says</h2>
            <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
              Two fields are required and the rest help. A fund added this way carries no
              eligibility rules — we would be inventing them — so its eligibility shows as{' '}
              <strong>unknown</strong>, and everything else still works: the deadline appears
              on your tracker, and the size is checked against what you are asking for.
            </p>
            <div style={{ marginTop: 'var(--s-5)' }}>
              <ManualFundForm
                action={addOwnFundAction}
                submitLabel="Add this fund"
                initial={EMPTY_MANUAL_FUND}
              />
            </div>
          </section>

          <details className="card" style={{ marginTop: 'var(--s-5)' }}>
            <summary className="paste-summary">
              <span>Have the guidance read for you instead</span>
              <span className="chev chev-toggle" aria-hidden="true" />
            </summary>
            <div className="paste-body">
              <p className="notice notice-caution">
                <span aria-hidden="true">⚠</span>
                <span>
                  Reading guidance needs an Anthropic key, and this deployment has none. Add
                  one in <a href="/settings">Settings</a> and it turns on — it proposes the
                  fund’s eligibility rules, each shown beside the funder’s own sentence, so
                  you check their words rather than ours.
                </span>
              </p>
              <AddOpportunity ready={false} />
            </div>
          </details>
        </>
      )}

      <section className="card" style={{ marginTop: 'var(--s-5)' }}>
        <h2 className="card-title">What happens to it</h2>
        <ol className="list" style={{ marginTop: 'var(--s-3)' }}>
          <li>
            We read the guidance and <strong>propose</strong> the fund’s rules — who can apply,
            how much, by when.
          </li>
          <li>
            You go through them. Each one shows the funder’s own sentence it came from, so you
            are checking their words, not ours.
          </li>
          <li>
            Only the rules you accept are used. Until then the fund’s eligibility reads as{' '}
            <strong>unknown</strong>, because that is what it is.
          </li>
        </ol>
        <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
          A fund you add is yours alone — no other organisation using this product can see it, or
          the guidance you pasted.
        </p>
      </section>
    </div>
  );
}
