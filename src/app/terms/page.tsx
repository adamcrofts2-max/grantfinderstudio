import type { Metadata } from 'next';

import { blanks, PUBLISHER, readyToPublish } from '@/domain/privacy/operator';
import { SHARE_DAYS } from '@/domain/review/share';

export const metadata: Metadata = {
  title: 'Terms of use — Grant Finder Studio',
  description: 'What this product does, what it does not claim, and what each side is responsible for.',
};

/**
 * Terms of use.
 *
 * ## Why this is mostly about what the product does NOT claim
 *
 * The dangerous thing a funding product can do is imply it knows your chances.
 * This one has been built the other way round from the start — readiness is
 * completeness and says so on its own card, `unknown` is never coerced to a
 * verdict, and no screen anywhere prints a probability of winning. Terms that
 * did not say so would be the one document in the product hedging in the
 * opposite direction from every screen in it.
 *
 * ## The same blanks as the privacy notice
 *
 * Who you are contracting with is not something this repository knows, so it
 * is the same `PUBLISHER` constant and the same banner. A contract with an
 * unnamed party is not a contract.
 */
export default function TermsPage() {
  const missing = blanks();
  const ready = readyToPublish();

  return (
    <div className="page page-narrow">
      <header className="page-head">
        <p className="eyebrow">Terms</p>
        <h1 className="page-title" style={{ marginTop: 'var(--s-2)' }}>
          Terms of use
        </h1>
        <p className="page-sub">
          What this product does, what it deliberately does not claim, and what each side is
          responsible for.
        </p>
      </header>

      {ready ? null : (
        <section className="notice notice-caution" style={{ marginBottom: 'var(--s-5)' }}>
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>These terms are a draft and are not in force.</strong> They still need{' '}
            {missing.join(', ')}. A contract with an unnamed party is not a contract, and
            nothing here should be relied on until somebody qualified has read it.
          </span>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Who you are dealing with</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          {ready
            ? `${PUBLISHER.legalName}, ${PUBLISHER.registeredAddress}.`
            : 'Not yet stated — see the notice above.'}
        </p>
      </section>

      <section className="card">
        <h2 className="card-title">What this product claims</h2>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>
            That the grants it shows you were really awarded, by the funder named, in the year
            given — because they come from what funders themselves published under an open
            licence, and every figure is traceable to a publisher.
          </li>
          <li>
            That an eligibility verdict follows from the rules recorded against a fund and the
            details you confirmed about your organisation. Where a rule cannot be checked it
            says so rather than assuming you pass.
          </li>
          <li>
            That an estimate of effort is an estimate of effort — hours of writing, from the
            length of the form.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">What it does not claim</h2>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>
            <strong>It does not know your chances.</strong> Nothing in this product is a
            probability of winning, and the readiness score is completeness, which is a
            different thing and says so on its own card.
          </li>
          <li>
            <strong>Awarded-grant data is history, not an open call.</strong> A funder who gave
            money in 2023 may have no fund open now. Always check with the funder before you
            apply.
          </li>
          <li>
            <strong>A fund you typed in is yours, unverified.</strong> We did not check it and
            do not vouch for its deadline or its rules.
          </li>
          <li>
            <strong>AI drafts are drafts.</strong> Anything the Writer produces is your
            responsibility to check before it goes to a funder. The product marks every
            sentence that no confirmed fact supports, and that marking is a tool, not a
            guarantee.
          </li>
          <li>
            <strong>It is not professional advice.</strong> Not legal, not financial, and not a
            substitute for reading the funder&rsquo;s own guidance.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Your side</h2>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>
            Keep your sign-in to yourself, and tell us if you think somebody else has it.
          </li>
          <li>
            Only upload documents you are entitled to upload. If they contain personal data
            about other people, you remain responsible for that data — we process it on your
            instructions.
          </li>
          <li>
            A review link hands one application to whoever holds it. Send it to the person you
            meant to, and withdraw it when they are done. It expires within {SHARE_DAYS} days
            regardless.
          </li>
          <li>
            Do not use this to scrape, resell, or rebuild the underlying data as a competing
            dataset. The open-licence data carries its publishers&rsquo; terms, and some of
            those licences are share-alike.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Our side</h2>
        <ul className="detected" style={{ marginTop: 'var(--s-3)' }}>
          <li>Keep your organisation&rsquo;s data separate from every other organisation&rsquo;s.</li>
          <li>Tell you when we cannot check something, rather than guessing.</li>
          <li>Hand your data back whenever you ask, and delete it when you say so.</li>
          <li>
            Not use what you write to train a model, and not sell it to anybody.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2 className="card-title">Ending it</h2>
        <p className="card-sub" style={{ marginTop: 'var(--s-2)' }}>
          You can delete your organisation at any time from your organisation page, and that is
          the end of it — no notice period, no retention of the account, nothing to cancel
          afterwards. Take your export first: once it is gone there is nothing to hand back.
        </p>
      </section>

      <p className="hint" style={{ marginTop: 'var(--s-6)' }}>
        <a href="/privacy">What we hold about you</a>
      </p>
    </div>
  );
}
