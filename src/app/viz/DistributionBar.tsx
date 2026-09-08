import type { AmountSummary } from '@/domain/funder/behaviour';

/**
 * What a funder actually gives, with the applicant's own ask marked on it.
 *
 * The most useful chart in the product, because it turns data into a decision
 * in one glance: is what I am asking for the sort of money this funder hands
 * out, or am I about to spend twenty hours asking the wrong trust?
 *
 * Drawn as EMPHASIS, not with a categorical palette. The distribution is
 * context and belongs in neutrals; the applicant's ask is the single mark that
 * matters and is the only coloured thing here. Colouring the quartiles would
 * bury the one point the reader came for.
 *
 * Built in HTML rather than SVG. A full-width SVG needs
 * `preserveAspectRatio="none"`, which stretches the x-axis independently of
 * the y — and that turns the circular marker into an ellipse at every width
 * except one. Absolutely-positioned elements on a percentage track have no
 * such problem, scale to any container, and keep the marker round.
 */

function money(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `£${Math.round(value / 1000)}k`;
  return `£${Math.round(value)}`;
}

export interface DistributionBarProps {
  amounts: AmountSummary;
  /** The applicant's own ask. Null when they have not said yet. */
  yourAskGbp: number | null;
  funderName: string;
}

export function DistributionBar({ amounts, yourAskGbp, funderName }: DistributionBarProps) {
  // The scale spans the funder's range AND the applicant's ask, so a request
  // far outside what they give sits visibly outside the box rather than being
  // clamped to the edge — being off the scale is the useful answer.
  const low = Math.min(amounts.min, yourAskGbp ?? amounts.min);
  const high = Math.max(amounts.max, yourAskGbp ?? amounts.max);
  const span = high - low;

  // A funder whose grants are all one size has no width to scale against;
  // centre the marks rather than dividing by zero.
  const at = (value: number): number => (span === 0 ? 50 : ((value - low) / span) * 100);

  const boxLeft = at(amounts.lowerQuartile);
  const boxWidth = Math.max(at(amounts.upperQuartile) - boxLeft, 1);

  const description =
    yourAskGbp === null
      ? `${funderName} gives between ${money(amounts.min)} and ${money(amounts.max)}, typically ${money(amounts.median)}.`
      : `${funderName} gives between ${money(amounts.min)} and ${money(amounts.max)}, typically ${money(amounts.median)}. You are asking for ${money(yourAskGbp)}.`;

  return (
    <figure className="viz-figure">
      <div className="viz-track" role="img" aria-label={description}>
        {/* Full range: the quietest mark. */}
        <div className="viz-rail" />
        {/* The middle half of their grants. */}
        <div
          className="viz-box grows"
          style={{ left: `${boxLeft}%`, width: `${boxWidth}%` }}
        />
        {/* Median. */}
        <div className="viz-median-tick" style={{ left: `${at(amounts.median)}%` }} />

        {yourAskGbp === null ? null : (
          <div className="viz-you" style={{ left: `${at(yourAskGbp)}%` }}>
            <span className="viz-you-dot" />
            <span className="viz-you-stem" />
          </div>
        )}
      </div>

      {/* Direct labels rather than an axis: three numbers a person can read.
          The chart fills sit below 3:1 against a light surface, which obliges
          labelling rather than allowing it. */}
      <div className="viz-scale">
        <span>{money(amounts.min)}</span>
        <span className="viz-median">typically {money(amounts.median)}</span>
        <span>{money(amounts.max)}</span>
      </div>

      <figcaption>
        {yourAskGbp === null
          ? 'Say what you are asking for and we will mark it on here.'
          : describeAsk(amounts, yourAskGbp)}
      </figcaption>
    </figure>
  );
}

/** One sentence saying what the mark means — never what it predicts. */
function describeAsk(amounts: AmountSummary, ask: number): string {
  if (ask < amounts.min) {
    return `Your ${money(ask)} is smaller than anything they have given. Some funders will not process an application this size.`;
  }
  if (ask > amounts.max) {
    return `Your ${money(ask)} is larger than anything they have given.`;
  }
  if (ask >= amounts.lowerQuartile && ask <= amounts.upperQuartile) {
    return `Your ${money(ask)} sits in the middle half of what they give.`;
  }
  return `Your ${money(ask)} is inside their range, but outside the middle half.`;
}
