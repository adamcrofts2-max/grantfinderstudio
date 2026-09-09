import { Highlight } from '@/app/marks';
import {
  DistributionExample,
  DraftExample,
  VerdictExample,
} from '@/app/landing/Examples';

/**
 * The front door.
 *
 * ## What the product actually is, in the order somebody meets it
 *
 * 1. FIND the funders worth approaching. Funders do not publish what is open,
 *    but they do publish what they have GIVEN — through 360Giving, under an
 *    open licence. Working back from awarded grants to the funders whose money
 *    already goes to organisations of your size, in your area, doing your kind
 *    of work, is real discovery on evidence rather than a scraped directory.
 * 2. WEIGH a specific fund: eligibility in code, the work in hours, what that
 *    makes it worth per hour, and the last day you could still start.
 * 3. WRITE the answers, optionally, from facts you have confirmed — every
 *    sentence citing the fact behind it, and any sentence without one flagged
 *    rather than smoothed over.
 *
 * ## The line this page walks
 *
 * An earlier version led with "this is not a search engine", which was true
 * and badly under-sold: finding funders IS half the product. But the opposite
 * mistake is worse, so nothing here claims a database of OPEN calls. There
 * isn't one and there is not going to be — see "what we will not build" in the
 * roadmap for the legal reasoning.
 *
 * The discovery section carries an honest status marker while the 360Giving
 * corpus is not yet ingested. The screens, the schema and the chart are built;
 * the data is not loaded. That marker comes down when it is, and not before.
 *
 * No testimonials, no customer count, no logos, no money-raised figure: there
 * are no customers yet. No pricing: it is not decided, and a figure invented
 * here is a promise made to somebody in a fortnight.
 */
export function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-in">
          <a className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">GF</span>
            <span>
              <span className="brand-name">Grant Finder</span>{' '}
              <span className="brand-sub">Studio</span>
            </span>
          </a>
          <nav className="lp-nav-links" aria-label="Sections">
            <a href="#find">Find funders</a>
            <a href="#weigh">Weigh a fund</a>
            <a href="#write">Write the bid</a>
          </nav>
          <div className="lp-nav-actions">
            <a className="lp-signin" href="/sign-in">Sign in</a>
            <a className="btn btn-primary btn-small" href="/sign-up">Create an account</a>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="lp-hero">
          <div className="lp-hero-words">
            <p className="eyebrow">For UK community interest companies</p>
            <h1 className="lp-title">
              Find funders who already give to{' '}
              <Highlight>work like yours</Highlight>.
            </h1>
            <p className="lp-lede">
              Funders rarely publish what is open. They do publish what they have already
              given — and that is the better evidence. We work back from awarded UK grants to
              the funders worth your time, weigh up each fund you find, and help you write the
              answers from facts you have confirmed.
            </p>
            <div className="lp-actions">
              <a className="btn btn-primary lp-cta" href="/sign-up">Create an account</a>
              <a className="btn btn-secondary lp-cta" href="#find">See how it works</a>
            </div>
            <p className="lp-quiet">
              An email address and a password. Nothing to install, and no card.
            </p>
          </div>
          <div className="lp-hero-art">
            <DistributionExample />
          </div>
        </section>

        <section className="lp-steps" aria-label="How it works">
          <ol className="lp-steps-list">
            <li>
              <span className="lp-step-n" aria-hidden="true">1</span>
              <h2 className="lp-step-h">Find who to ask</h2>
              <p>
                Funders whose past giving matches your size, your area and your kind of work —
                with the grants they actually made as the evidence.
              </p>
            </li>
            <li>
              <span className="lp-step-n" aria-hidden="true">2</span>
              <h2 className="lp-step-h">Weigh what you found</h2>
              <p>
                Eligibility checked against the funder’s own words, the work priced in hours,
                and the last day you could still start.
              </p>
            </li>
            <li>
              <span className="lp-step-n" aria-hidden="true">3</span>
              <h2 className="lp-step-h">Write it</h2>
              <p>
                Draft from facts you have confirmed, with every sentence showing the fact
                behind it — or write it yourself from a blank box.
              </p>
            </li>
          </ol>
        </section>

        <section className="lp-feature" id="find">
          <div className="lp-feature-words">
            <p className="eyebrow">One · Find</p>
            <h2 className="lp-h2">The evidence is in what funders have already given</h2>
            <p className="lp-body">
              Hundreds of UK funders publish their awarded grants openly, through the 360Giving
              standard. That data answers the question a directory cannot: not “who might fund
              this” but <strong>who has actually written this cheque before</strong> — to an
              organisation your size, in your area, for work like yours.
            </p>
            <p className="lp-body">
              So you get a shortlist with its reasoning attached: what they typically give,
              how often, to whom, and how your ask compares to the grants they really make. A
              funder whose median grant is £9,000 is not the right ask for £30,000, and that is
              worth knowing before you write anything.
            </p>
            <p className="lp-status">
              <span className="lp-status-tag">In build</span>
              The screens, the matching and the charts are finished. The grant corpus is being
              loaded — until it is, you add the funds you already know about by hand.
            </p>
          </div>
          <div className="lp-feature-art">
            <ul className="lp-match">
              <li>
                <div>
                  <p className="lp-match-name">A community foundation</p>
                  <p className="lp-match-why">
                    38 grants to CICs in your county · median £9,000 · typically 12 months
                  </p>
                </div>
                <span className="pill pill-positive">Close match</span>
              </li>
              <li>
                <div>
                  <p className="lp-match-name">A national youth trust</p>
                  <p className="lp-match-why">
                    12 grants for skills work · median £24,000 · rarely funds under £15,000
                  </p>
                </div>
                <span className="pill pill-accent">Worth a look</span>
              </li>
              <li>
                <div>
                  <p className="lp-match-name">A capital-only foundation</p>
                  <p className="lp-match-why">
                    Buildings and equipment only · no revenue grants on record
                  </p>
                </div>
                <span className="pill pill-negative">Not for this</span>
              </li>
            </ul>
            <p className="lp-demo-cap">
              Illustration — invented funders. Real matches cite the grants they came from.
            </p>
          </div>
        </section>

        <section className="lp-feature lp-feature-flip" id="weigh">
          <div className="lp-feature-words">
            <p className="eyebrow">Two · Weigh</p>
            <h2 className="lp-h2">Whether this one is worth your week</h2>
            <p className="lp-body">
              Bring the fund — from a newsletter, a council email, a funder’s own page. Ten
              kinds of rule are checked in code against what you have told us: legal form,
              area, amount, how long you have traded, match funding, who benefits and the rest.
              Every verdict shows the funder’s own sentence it came from, so you are checking
              their words and not ours.
            </p>
            <p className="lp-body">
              Then the part nobody else tells you: roughly how many hours the form will take,
              what that makes the grant worth per hour, and the last day you could still start
              and finish it.
            </p>
            <p className="lp-note-inline">
              When a rule cannot be settled it stays <strong>unknown</strong>. It is never
              rounded up to a yes.
            </p>
          </div>
          <div className="lp-feature-art">
            <VerdictExample />
          </div>
        </section>

        <section className="lp-feature" id="write">
          <div className="lp-feature-words">
            <p className="eyebrow">Three · Write</p>
            <h2 className="lp-h2">Drafting that cannot make things up about you</h2>
            <p className="lp-body">
              Paste the funder’s questions and you can have each answer drafted — or write
              every word yourself. It is an option, not the point of the product.
            </p>
            <p className="lp-body">
              When you do use it, it only ever sees facts you have confirmed. Every sentence it
              writes has to name the fact behind it, and a sentence that cites something we did
              not give it is thrown away before you ever see it. Where no fact supports a claim,
              it says so and asks you rather than inventing a number.
            </p>
            <p className="lp-note-inline">
              That is why it will hand back a short answer instead of filling the word count.
              Padding is how invented detail gets in.
            </p>
          </div>
          <div className="lp-feature-art">
            <DraftExample />
          </div>
        </section>

        <section className="lp-band">
          <div className="lp-band-in">
            <h2 className="lp-h2">What it will not do</h2>
            <ul className="lp-wont-list">
              <li>
                <strong>It will tell you not to apply.</strong> Knowing what to skip is most of
                the value. A fund you are not eligible for is shown as not worth it, with the
                reason, rather than buried at the bottom of a list.
              </li>
              <li>
                <strong>It will not predict your chances.</strong> Nothing here claims to know
                whether you will win. It estimates effort and checks rules — two things that
                can be worked out — and refuses to put a percentage on the one that cannot.
              </li>
              <li>
                <strong>It will not claim a fund is open when nobody knows.</strong> A deadline
                we have not seen the funder publish is labelled as an estimate, not a date.
              </li>
              <li>
                <strong>It will not copy funders’ pages into a database.</strong> Awarded-grant
                data is used under its open licence. A fund you bring is read for you, kept to
                you, and linked back to the funder’s own page.
              </li>
              <li>
                <strong>Nobody else can see your work.</strong> Your facts, documents and
                applications are yours. Even the console this service is run from has no
                database privilege to read them — enforced by Postgres, not by a promise.
              </li>
            </ul>
          </div>
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
        <div className="lp-foot-in">
          <p>Grant Finder Studio — funding intelligence for UK community interest companies.</p>
          <p>
            Awarded-grant data from <span className="lp-foot-em">360Giving</span>, used under
            CC BY 4.0. <a href="/sign-in">Sign in</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
