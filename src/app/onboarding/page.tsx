import { readEnvironment } from '@/env';
import { readSetupProgress } from '@/app/setup';

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
 *
 * The page knows what has already been answered. Somebody who has saved their
 * organisation and been sent here to add their project used to arrive at a
 * heading reading "Let's find your organisation", a search box they had
 * already finished with, and their actual task collapsed behind a small
 * "Open" link near the bottom. The instruction and the page disagreed, which
 * is the fastest way to lose a person who is not sure they belong here.
 */
export default async function OnboardingPage() {
  const progress = await readSetupProgress();
  const organisationDone = progress?.steps.find((step) => step.id === 'organisation')?.done === true;
  const projectDone = progress?.steps.find((step) => step.id === 'project')?.done === true;

  // Once we know who they are, the project is the job. The lookup that got
  // them here stays available, below, rather than in the way.
  const onTheProject = organisationDone && !projectDone;

  // No lookup configured means the search can only ever fail. Leading with a
  // box that cannot work, and hiding the one that can behind a disclosure, is
  // a maze — so when it is unavailable the manual form is the page.
  const lookupAvailable = readEnvironment().companiesHouseBaseUrl !== null;

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Set up</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {onTheProject
            ? 'Now — what are you trying to fund?'
            : lookupAvailable
              ? 'Let’s find your organisation'
              : 'Tell us about your organisation'}
        </h1>
        <p className="page-sub">
          {onTheProject ? (
            <>
              We know who you are. The amount you need, how long for and who it is for are
              what most eligibility rules actually turn on — and what puts your ask on the
              charts beside what each funder really gives.
            </>
          ) : lookupAvailable ? (
            <>
              We’ll look you up on the Companies House register so you don’t have to type your
              details — and so we get your legal form exactly right. It decides which funds you
              can apply to.
            </>
          ) : (
            <>
              Your legal form and where you are based decide which funds you can apply to at
              all, so these few answers are what make every eligibility check worth trusting.
              It takes about a minute.
            </>
          )}
        </p>
      </header>

      {onTheProject ? <ProjectForm open /> : null}

      {onTheProject || !lookupAvailable ? null : (
        <section className="card">
          <CompanySearch />
        </section>
      )}

      {lookupAvailable && !onTheProject ? (
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
        </section>
      ) : null}

      <ManualProfile open={!organisationDone && !lookupAvailable} />

      {onTheProject ? null : <ProjectForm open={projectDone === false && organisationDone} />}

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
    </div>
  );
}
