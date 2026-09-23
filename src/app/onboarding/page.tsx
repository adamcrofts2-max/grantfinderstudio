import { readSetupProgress } from '@/app/setup';

import { CompanySearch } from './CompanySearch';
import { lookupIsAvailable } from './lookup';
import { ManualProfile } from './ManualProfile';
import { ProjectForm } from './ProjectForm';
import { WorkForm } from './WorkForm';

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

  // Once we know who they are, what they DO is the job — then the project.
  // Setup used to go straight from legal identity to the project, and the
  // work itself was never asked about at all. The lookup that got them here
  // stays available, below, rather than in the way.
  const workToAsk = progress?.unansweredAboutTheWork ?? [];
  const onTheWork = organisationDone && workToAsk.length > 0;
  const onTheProject = organisationDone && !onTheWork && !projectDone;
  const pastTheOrganisation = onTheWork || onTheProject;

  // No lookup configured means the search can only ever fail. Leading with a
  // box that cannot work, and hiding the one that can behind a disclosure, is
  // a maze — so when it is unavailable the manual form is the page.
  //
  // What makes it available is a stored KEY, not the optional base-URL
  // override this used to read. See `lookupIsAvailable`.
  const lookupAvailable = await lookupIsAvailable();

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Set up</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          {onTheWork
            ? 'Now — what do you do?'
            : onTheProject
              ? 'Now — what are you trying to fund?'
              : lookupAvailable
                ? 'Let’s find your organisation'
                : 'Tell us about your organisation'}
        </h1>
        <p className="page-sub">
          {onTheWork ? (
            <>
              We know who you are. What you do, who it is for and how many people you reach are
              the first questions on nearly every application form — and the Writer can only
              draft from what you tell us, so this is what it will write from.
            </>
          ) : onTheProject ? (
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

      {onTheWork ? <WorkForm questions={workToAsk} open /> : null}

      {onTheProject ? <ProjectForm open /> : null}

      {pastTheOrganisation || !lookupAvailable ? null : (
        <section className="card">
          <CompanySearch />
        </section>
      )}

      {lookupAvailable && !pastTheOrganisation ? (
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

      {/* Folded while the work is being asked, so there is one question on
          the page rather than two. */}
      {onTheProject ? null : (
        <ProjectForm open={projectDone === false && organisationDone && !onTheWork} />
      )}

      {/* About the legal details, so only while they are what is being asked.
          Under "what do you do" it answered a question nobody had. */}
      {pastTheOrganisation ? null : (
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
      )}
    </div>
  );
}
