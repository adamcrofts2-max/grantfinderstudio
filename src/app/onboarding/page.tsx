import { CompanySearch } from './CompanySearch';
import { ManualProfile } from './ManualProfile';
import { ProjectForm } from './ProjectForm';

export const dynamic = 'force-dynamic';

/**
 * First screen for a new organisation.
 *
 * Search by name rather than asking for a company number: a founder always
 * knows their organisation's name, and often does not have the number to
 * hand — sending them off to find it means losing them in the first minute.
 *
 * One pick fills in six fields they never type, and settles the one question
 * they most often get wrong about themselves: whether their CIC is limited by
 * guarantee or by shares. 87% are limited by guarantee, so roughly one in
 * eight self-declarations would be wrong, and on a fund restricted to bodies
 * with no share capital that error turns a hard exclusion into a false pass.
 *
 * Lookup is nonetheless a convenience, never a gate: every failure path leaves
 * the manual route open, and anything entered by hand is recorded as
 * self-declared rather than verified.
 */
export default function OnboardingPage() {
  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Set up</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Let’s find your organisation
        </h1>
        <p className="page-sub">
          We’ll look you up on the Companies House register so you don’t have to type your
          details — and so we get your legal form exactly right. It decides which funds you
          can apply to.
        </p>
      </header>

      <section className="card">
        <CompanySearch />
      </section>

      <section className="card">
        <h2 className="card-title">Can’t find it, or not registered?</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          You can enter your details yourself. We’ll mark them as{' '}
          <span className="provenance provenance-declared">
            <span aria-hidden="true">◐</span> self-declared
          </span>{' '}
          rather than{' '}
          <span className="provenance provenance-verified">
            <span aria-hidden="true">✓</span> verified
          </span>
          , and any eligibility check that depends on them will say so rather than sounding
          more certain than it is.
        </p>
        <p className="notice notice-caution" style={{ marginTop: 'var(--s-4)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            Manual entry is not built yet. It is the next piece of onboarding — see
            docs/ROADMAP.md.
          </span>
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">Why we ask</h2>
        <ul
          style={{
            margin: 'var(--s-3) 0 0',
            paddingLeft: '1.1rem',
            color: 'var(--ink-soft)',
            fontSize: 'var(--t-sm)',
          }}
        >
          <li style={{ marginBottom: 'var(--s-2)' }}>
            <strong>Your legal form</strong> decides eligibility. Funders treat CICs limited by
            guarantee and by shares differently, and many people don’t know which they are.
          </li>
          <li style={{ marginBottom: 'var(--s-2)' }}>
            <strong>Your incorporation date</strong> settles the “must have traded two years”
            requirement that a lot of funds apply.
          </li>
          <li>
            <strong>Your registered name</strong> is what funders expect on the application.
          </li>
        </ul>
      </section>

      <ManualProfile />

      <ProjectForm />
    </div>
  );
}
