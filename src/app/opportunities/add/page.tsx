import { isWriterAvailable } from '@/app/drafting';

import { AddOpportunity } from './AddOpportunity';

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
          have, we read the funder’s own page with you.
        </p>
      </header>

      {writerAvailable ? null : (
        <p className="notice notice-caution">
          <span aria-hidden="true">⚠</span>
          <span>
            Reading guidance needs an Anthropic key. Add one in <a href="/settings">Settings</a>{' '}
            first.
          </span>
        </p>
      )}

      <AddOpportunity />

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
