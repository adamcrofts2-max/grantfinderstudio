import { Figure } from '@/app/illustration/Figure';
import { Highlight } from '@/app/marks';

/**
 * The front door.
 *
 * Until this existed, a stranger arriving at the root was redirected to a
 * password box: a product they had never heard of, asking them to sign in to
 * it. This page is the answer to "what is this and why would I bother", for
 * somebody running a small CIC who may never have applied for funding.
 *
 * ## The one claim it must not make
 *
 * Every funding product on the market sells a DATABASE — search thousands of
 * grants, never miss an opportunity. This one has no database of open funds
 * and is never going to have one: there is no machine-readable source of open
 * UK trust and foundation calls, and building one by crawling would run into
 * the sui generis database right and most funders' own terms (recorded under
 * "what we will not build" in the roadmap).
 *
 * So the page leads with the thing that is true and that nobody else says:
 * there is no list, and we will not pretend. What the product sells is
 * judgement about a fund you already found — which is a smaller promise, and
 * one it can actually keep.
 *
 * ## What is deliberately absent
 *
 * No testimonials, no customer count, no logos, no "£2m raised". There are no
 * customers yet, and a landing page that opens with an invented number has
 * already told the reader what kind of product this is.
 *
 * No pricing either — it has not been decided, and inventing a figure here
 * would be a promise made to somebody in a fortnight.
 *
 * Every number on this page is checkable: ten criterion kinds are the ten in
 * `domain/eligibility/types.ts`; the Find a Grant figure is from the research
 * in PRODUCT_ARCHITECTURE.md §2.3.
 */
export function Landing() {
  return (
    <div className="lp">
      <header className="lp-top">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">GF</span>
          <span>
            <span className="brand-name">Grant Finder</span>{' '}
            <span className="brand-sub">Studio</span>
          </span>
        </a>
        <a className="lp-signin" href="/sign-in">Sign in</a>
      </header>

      <main id="main">
        <section className="lp-hero">
          <div className="lp-hero-words">
            <p className="eyebrow">For UK community interest companies</p>
            <h1 className="lp-title">
              Know which bids are{' '}
              <Highlight>worth your week</Highlight>.
            </h1>
            <p className="lp-lede">
              Writing a funding bid takes days you do not have. Bring us a fund you are looking
              at and we will tell you whether you are eligible, roughly how many hours it would
              take, and whether what you are asking for is the size that funder actually gives.
            </p>
            <div className="lp-actions">
              <a className="btn btn-primary lp-cta" href="/sign-up">Create an account</a>
              <a className="btn btn-secondary" href="/sign-in">Sign in</a>
            </div>
            <p className="lp-quiet">
              An email address and a password. Nothing else to start, and nothing to install.
            </p>
          </div>
          <div className="lp-hero-art">
            <div className="figure-stage">
              <Figure />
            </div>
          </div>
        </section>

        {/* The claim the rest of the product rests on, said first because it is
            the one a reader can check against every competitor's home page. */}
        <section className="lp-truth">
          <h2 className="lp-h2">There is no list of open funds. We are not going to pretend there is.</h2>
          <p className="lp-body">
            Government’s own service, Find a Grant, carries around 120 grants — central
            government only, no trusts or foundations at all. The commercial databases that
            claim thousands are compiled by researchers, by hand, and they go stale. Nobody
            publishes a machine-readable list of what UK trusts have open, because it does not
            exist.
          </p>
          <p className="lp-body">
            So this is not a search engine with a funding badge on it. You bring the fund —
            from a newsletter, a council email, a funder’s own page — and we do the part that
            actually costs you a week: working out whether it is worth writing.
          </p>
        </section>

        <section className="lp-does">
          <h2 className="lp-h2">What it does with a fund you bring</h2>
          <ul className="lp-grid">
            <li className="card lp-card">
              <h3 className="lp-h3">Eligibility, checked rather than guessed</h3>
              <p className="lp-body">
                Ten kinds of rule — legal form, area, amount, how long you have traded, match
                funding, who benefits and the rest — evaluated in code against what you have
                told us. Every verdict shows the funder’s own sentence it came from, so you are
                checking their words and not ours.
              </p>
              <p className="lp-note">
                When a rule cannot be settled it stays <strong>unknown</strong>. It is never
                rounded up to a yes.
              </p>
            </li>

            <li className="card lp-card">
              <h3 className="lp-h3">What applying would actually cost you</h3>
              <p className="lp-body">
                Paste the funder’s questions and you get the work in hours, from the length of
                the answers and what they ask for — then what that makes the bid worth per hour
                of your time. A £5,000 grant behind thirty hours of forms is a different
                proposition from a £5,000 grant behind three.
              </p>
            </li>

            <li className="card lp-card">
              <h3 className="lp-h3">The last day you could still start</h3>
              <p className="lp-body">
                A deadline on its own tells you nothing you did not know. We work backwards
                from the writing still to do, at the hours a week you actually have, and give
                you the date after which it stops being possible — and say plainly when a bid
                has already gone past it.
              </p>
            </li>

            <li className="card lp-card">
              <h3 className="lp-h3">Answers built only from what you confirmed</h3>
              <p className="lp-body">
                Facts about your organisation come from Companies House, from documents you
                share, or from you typing them in. Nothing is used in an application until you
                have looked at it and said it is right. Any claim with no confirmed fact behind
                it is flagged as outstanding work rather than quietly written for you.
              </p>
            </li>
          </ul>
        </section>

        {/* The trust section, and the reason it is phrased as refusals: every
            one of these is a thing the product could do and deliberately does
            not, which is a stronger signal than another list of features. */}
        <section className="lp-wont">
          <h2 className="lp-h2">What it will not do</h2>
          <ul className="lp-wont-list">
            <li>
              <strong>It will tell you not to apply.</strong> Knowing what to skip is most of
              the value. A fund you are not eligible for is shown as not worth it, with the
              reason, rather than buried at the bottom of a list.
            </li>
            <li>
              <strong>It will not predict your chances.</strong> Nothing here claims to know
              whether you will win. It estimates effort and checks rules — two things that can
              be worked out — and refuses to put a percentage on the one that cannot.
            </li>
            <li>
              <strong>It will not invent a fact about you.</strong> Every fact carries where it
              came from and who confirmed it, and an unconfirmed one cannot reach an
              application.
            </li>
            <li>
              <strong>It will not copy funders’ pages into a database.</strong> A fund you
              bring is read for you, kept to you, and linked back to the funder’s own page.
            </li>
            <li>
              <strong>Nobody else can see your work.</strong> Your organisation’s facts,
              documents and applications are yours. Even the console the service is run from
              has no database privilege to read them — that is enforced by Postgres, not by a
              promise.
            </li>
          </ul>
        </section>

        <section className="lp-start">
          <h2 className="lp-h2">Start with one fund</h2>
          <p className="lp-body">
            Tell us about your organisation, add the fund on your desk, and see what it says.
            If the answer is “do not bother”, that was worth knowing before Tuesday.
          </p>
          <div className="lp-actions">
            <a className="btn btn-primary lp-cta" href="/sign-up">Create an account</a>
          </div>
        </section>
      </main>

      <footer className="lp-foot">
        <p>
          Grant Finder Studio — funding intelligence for UK community interest companies.
        </p>
        <p>
          <a href="/sign-in">Sign in</a>
        </p>
      </footer>
    </div>
  );
}
