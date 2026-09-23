import type { Metadata } from 'next';

import {
  PRIVACY_RECORD,
  YOURS_IN_SHARED_TABLES,
  RECIPIENTS,
  retentionLine,
  sharedWith,
  type Held,
  type Recipient,
  type Subject,
} from '@/domain/privacy/record';
import { blanks, PUBLISHER, readyToPublish } from '@/domain/privacy/operator';
import { SHARE_DAYS } from '@/domain/review/share';
import { ACCOUNT_CONSTANTS } from '@/domain/auth/account';

export const metadata: Metadata = {
  title: 'Privacy — Grant Finder Studio',
  description: 'What this product holds about your organisation, why, where it goes and how long it stays.',
};

/**
 * The privacy notice, rendered from the record rather than written out.
 *
 * ## Why it is generated
 *
 * A notice typed by hand is accurate on the day it is typed and drifts with
 * the next migration, silently, because nothing checks. This page reads
 * `PRIVACY_RECORD`, and a database test holds that record to the live schema:
 * a table nobody has classified fails the build. The consequence is that this
 * page cannot quietly stop describing the database it runs on.
 *
 * ## Why it admits what it does not know
 *
 * Nothing in this repository knows who legally controls the data. Rather than
 * print a plausible company name, the blanks are null and the page says, at
 * the top, that it is not ready to publish. That banner is load-bearing: a
 * notice that names the wrong controller is worse than one with an obvious
 * hole in it, because nobody goes looking.
 */

const GROUPS: ReadonlyArray<{ id: Subject; title: string; blurb: string }> = [
  {
    id: 'organisation',
    title: 'About your organisation',
    blurb:
      'Everything here belongs to the organisation. You can download all of it, and deleting the organisation removes every row of it.',
  },
  {
    id: 'person',
    title: 'About you personally',
    blurb:
      'What it takes to let you back in. If your organisation is deleted and you belong to no other, this goes with it.',
  },
  {
    id: 'operational',
    title: 'Keeping the door shut',
    blurb: 'Not about you so much as about attacks on you. Short-lived, and counts rather than identities.',
  },
];

function HeldRow({ held }: { held: Held }) {
  return (
    <li className="held">
      <div className="held-head">
        <h3 className="held-label">{held.label}</h3>
        <code className="held-table">{held.table}</code>
      </div>
      <p className="held-holds">{held.holds}</p>
      <p className="hint">{held.why}</p>
      <p className="hint">{retentionLine(held.kept)}</p>
      {held.leaves.length === 0 ? (
        <p className="held-leaves held-stays">Never leaves this system.</p>
      ) : (
        <p className="held-leaves">
          Seen by {held.leaves.map((r) => RECIPIENTS[r].name).join(' and ')}.
        </p>
      )}
    </li>
  );
}

function Recipients() {
  const order: Recipient[] = ['anthropic', 'companies_house', 'reviewer'];
  return (
    <ul className="stack" style={{ marginTop: 'var(--s-4)' }}>
      {order.map((id) => {
        const who = RECIPIENTS[id];
        const what = sharedWith(id);
        return (
          <li className="card" key={id}>
            <h3 className="card-title">{who.name}</h3>
            <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>{who.what}</p>
            <p className="hint" style={{ marginTop: 'var(--s-2)' }}>{who.why}</p>
            <p className="criteria-why" style={{ marginTop: 'var(--s-3)' }}>
              {what.length === 0
                ? 'Nothing currently goes to them.'
                : `Covers: ${what.map((h) => h.label.toLowerCase()).join(', ')}.`}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

export default function PrivacyPage() {
  const missing = blanks();
  const ready = readyToPublish();

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Privacy</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          What we hold, and what we do with it
        </h1>
        <p className="page-sub">
          This page is generated from the database itself, so it cannot quietly stop being
          true. Every table below is a real table, and a table that exists without being
          described here fails our build.
        </p>
      </header>

      {/* THE BANNER IS LOAD-BEARING.
          A notice that does not name its controller does not do the job the
          law gives it. Rather than print a plausible company name, the page
          says what is missing until somebody fills it in. */}
      {ready ? null : (
        <section className="notice notice-caution" style={{ marginBottom: 'var(--s-5)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>This notice is not finished and must not be relied on yet.</strong> It
            still needs {missing.join(', ')}. Everything below about the data itself is
            accurate — it is read from the schema — but until those blanks are filled by
            somebody who knows the answers, and the whole thing is read by someone
            qualified to check it, this is a draft.
          </span>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">The short version</h2>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>There is no analytics, no tracking and no third-party script on any page.</li>
          <li>No IP address, device or location is stored anywhere. There is no column for one.</li>
          <li>
            A document you upload is read for its text and the original file is then thrown
            away. We never hold the file itself.
          </li>
          <li>
            Nothing is sent to an AI model unless you press the button that sends it, and the
            product works with no AI key at all.
          </li>
          <li>
            One cookie, <code>{'gfs_session'}</code>, which keeps you signed in for{' '}
            {ACCOUNT_CONSTANTS.sessionDays} days. It is not readable by scripts and there is
            nothing else in it.
          </li>
          <li>
            You can download everything we hold, at any time, as one file. You can delete all
            of it, and deletion is immediate and permanent.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Who is responsible</h2>
        {ready ? (
          <>
            <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
              {PUBLISHER.legalName}, {PUBLISHER.registeredAddress}.
            </p>
            <p className="hint" style={{ marginTop: 'var(--s-2)' }}>
              ICO registration {PUBLISHER.icoRegistration}. Data-protection requests go to{' '}
              {PUBLISHER.contactEmail}. The database lives in {PUBLISHER.hostedIn}.
            </p>
          </>
        ) : (
          <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
            Not yet stated — see the notice above. This section will name the company, its
            registered address, its ICO registration, the address that answers a request, and
            where the database physically lives.
          </p>
        )}
      </section>

      {GROUPS.map((group) => {
        const rows = PRIVACY_RECORD.filter((held) => held.subject === group.id);
        if (rows.length === 0) return null;
        return (
          <section key={group.id} style={{ marginTop: 'var(--s-6)' }}>
            <h2 className="card-title">{group.title}</h2>
            <p className="card-sub" style={{ marginBottom: 'var(--s-4)', maxWidth: '46rem' }}>
              {group.blurb}
            </p>
            <ul className="held-list">
              {rows.map((held) => (
                <HeldRow held={held} key={held.table} />
              ))}
              {/* Yours, inside tables that are otherwise everybody's. Listed
                  with the organisation's own data because that is what they
                  are — and because an earlier version of this page, and of
                  the export, left them out. */}
              {group.id === 'organisation'
                ? YOURS_IN_SHARED_TABLES.map((owned) => (
                    <li className="held" key={owned.table}>
                      <div className="held-head">
                        <h3 className="held-label">{owned.label}</h3>
                        <code className="held-table">{owned.table}</code>
                      </div>
                      <p className="held-holds">{owned.holds}</p>
                      <p className="hint">
                        The rest of this table is shared reference data. Only the rows you
                        added are yours, and only you can see them.
                      </p>
                      <p className="hint">{retentionLine({ kind: 'while_open' })}</p>
                      <p className="held-leaves held-stays">Never leaves this system.</p>
                    </li>
                  ))
                : null}
            </ul>
          </section>
        );
      })}

      <section style={{ marginTop: 'var(--s-6)' }}>
        <h2 className="card-title">Who else ever sees it</h2>
        <p className="card-sub" style={{ marginBottom: 'var(--s-2)', maxWidth: '46rem' }}>
          Three, and no others. Nothing is sold, and nothing is used to train anybody&rsquo;s
          model on your writing.
        </p>
        <Recipients />
      </section>

      <section className="card" style={{ marginTop: 'var(--s-6)' }}>
        <h2 className="card-title">What you can do about it</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          Two of these are buttons rather than requests, because a right you have to ask for
          politely is not much of a right.
        </p>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>
            <strong>Take a copy.</strong> Your organisation page has a download of everything
            above, as one file, with a legend so it reads without our schema.
          </li>
          <li>
            <strong>Delete all of it.</strong> Also on your organisation page. It tells you
            what it is about to remove, asks you to type the organisation&rsquo;s name, and
            then does it. There is no recovery afterwards and no grace period.
          </li>
          <li>
            <strong>Correct something.</strong> Every fact about your organisation is editable
            where it is shown. A correction supersedes rather than overwrites, so the record of
            what you believed and when stays intact.
          </li>
          <li>
            <strong>Withdraw a review link.</strong> Any live link, from the application it
            belongs to. A link lasts at most {SHARE_DAYS} days in any case.
          </li>
          <li>
            <strong>Complain.</strong> To us first, and to the Information Commissioner&rsquo;s
            Office if we do not put it right.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Backups</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          A deletion removes the row from the live database at once. Whether a copy survives
          in a backup, and for how long, depends on how the database is hosted — so this page
          will not state a number until there is a real one to state. Until then, treat
          &ldquo;deleted&rdquo; as true of the running system and unverified of backups.
        </p>
      </section>

      <p className="hint" style={{ marginTop: 'var(--s-6)' }}>
        <a href="/terms">Terms of use</a>
      </p>
    </div>
  );
}
