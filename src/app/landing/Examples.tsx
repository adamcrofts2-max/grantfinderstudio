import type { ReactNode } from 'react';

import { DistributionBar } from '@/app/viz/DistributionBar';
import { RecommendationPill } from '@/app/components';

/**
 * The product's own components, on the front door.
 *
 * Not screenshots and not redrawn marketing versions: these import the very
 * same `DistributionBar` and `RecommendationPill` the application renders, so
 * the page cannot show something the product does not do, and cannot drift
 * away from it either — a change to the chart changes this too.
 *
 * The NUMBERS in them are invented, and every one of these says so out loud.
 * A landing page carrying a plausible-looking funder with plausible-looking
 * grant sizes is a fabricated record, and this product's whole argument is
 * that it does not fabricate.
 */

function Example({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="lp-demo">
      <div className="lp-demo-body">{children}</div>
      <figcaption className="lp-demo-cap">{label}</figcaption>
    </figure>
  );
}

/** What a funder actually gives, with your own ask marked against it. */
export function DistributionExample() {
  return (
    <Example label="Illustration — the figures are invented. The chart is the one the product draws.">
      <div className="lp-demo-head">
        <span className="lp-demo-title">A trust you are considering</span>
        <span className="badge badge-neutral">41 grants</span>
      </div>
      <DistributionBar
        amounts={{
          min: 2000,
          lowerQuartile: 5000,
          median: 9000,
          upperQuartile: 15_000,
          max: 40_000,
        }}
        yourAskGbp={30_000}
        funderName="this funder"
      />
      <p className="lp-demo-read">
        Half their grants land between £5k and £15k. You are asking for £30,000 — the top of
        their range, not the middle of it.
      </p>
    </Example>
  );
}

/** The verdict on one fund: worth it, what it costs, and why. */
export function VerdictExample() {
  return (
    <Example label="Illustration — the fund is invented. The verdict, the figures and the wording are the product’s.">
      <div className="lp-demo-head">
        <span className="lp-demo-title">A fund you brought us</span>
        <RecommendationPill value="strong" />
      </div>
      <p className="lp-demo-lead">
        £30,000 for about 11 hours of work. You meet every criterion we can check.
      </p>
      <dl className="lp-demo-figures">
        <div>
          <dt>Effort</dt>
          <dd>~11h</dd>
        </div>
        <div>
          <dt>Per hour</dt>
          <dd>£2,727</dd>
        </div>
        <div>
          <dt>Start by</dt>
          <dd>14 Oct</dd>
        </div>
      </dl>
      <ul className="lp-demo-checks">
        <li>
          <span className="badge badge-positive"><span aria-hidden="true">✓</span>Met</span>
          <span>Legal form — <q>open to charities and community interest companies</q></span>
        </li>
        <li>
          <span className="badge badge-positive"><span aria-hidden="true">✓</span>Met</span>
          <span>Area — <q>we fund across the South West</q></span>
        </li>
        <li>
          <span className="badge badge-caution"><span aria-hidden="true">?</span>Unknown</span>
          <span>Match funding — their guidance does not say</span>
        </li>
      </ul>
    </Example>
  );
}

/** A drafted answer, with every sentence tied to a fact or flagged. */
export function DraftExample() {
  return (
    <Example label="Illustration — a real draft cites your own confirmed facts by name.">
      <div className="lp-demo-head">
        <span className="lp-demo-title">Who will benefit, and how?</span>
        <span className="badge badge-neutral">140 of 150 words</span>
      </div>
      <div className="lp-draft">
        <p>
          We work with young people aged 14 to 19 across Somerset.
          <span className="lp-cite">Beneficiary groups · confirmed</span>
        </p>
        <p>
          Last year 132 took part in our twelve-week practical skills course.
          <span className="lp-cite">People supported last year · confirmed</span>
        </p>
        <p className="lp-draft-open">
          This grant would let us run two further cohorts.
          <span className="lp-cite lp-cite-open">No fact behind this yet — you will be asked</span>
        </p>
      </div>
    </Example>
  );
}
