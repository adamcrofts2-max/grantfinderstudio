import { formatDate } from '@/domain/time/format';
import { FindTheirPage } from '@/app/FindTheirPage';
import { gbp } from '@/app/components';
import { canCharacterise, whyThisFunder } from '@/domain/grants/funders';
import type { FunderRankContext } from '@/domain/grants/funders';
import type { FunderSummary } from '@/db/grants';

/**
 * The matching grants, as the funders who gave them.
 *
 * ## Why this is the default view
 *
 * The applicant's question is not "which grants mention youth work", it is
 * "who would fund us, and for how much". Twenty grant rows from one foundation
 * answer that worse than one line saying *18 grants like yours, typically
 * £10,000–£35,000, last gave March 2025, 6 of them in Somerset* — because the
 * decision is about a funder, and a list of grants makes the reader do the
 * grouping in their head.
 *
 * The grants are still there, folded into each funder and listed in full on
 * the other tab. Nothing is hidden; it is ordered around the decision.
 *
 * ## Two rules about the figures
 *
 * They describe the MATCHING grants, not the funder's whole history — "what do
 * they give for work like ours" is the question a search has already framed.
 * And they are not given at all below `MIN_AWARDS_TO_CHARACTERISE`: a median
 * over three grants is not a policy, so those rows name the grants instead of
 * summarising them. Saying less is the honest option, and `whyThisFunder`
 * carries the same restraint.
 */

function year(date: string | null): string {
  return date === null ? '—' : date.slice(0, 4);
}

function when(date: string | null): string {
  if (date === null) return 'date not published';
  const [y, m] = date.split('-');
  const month = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][Number(m) - 1];
  return month === undefined ? y! : `${month} ${y}`;
}

function Row({ funder, context }: { funder: FunderSummary; context: FunderRankContext }) {
  const described = canCharacterise(funder.matching);
  const why = whyThisFunder(funder, context);

  return (
    <li className="funder-card">
      <details>
        <summary className="funder-summary">
          <span className="funder-head">
            <span className="funder-name">{funder.funderName}</span>
            <span className="funder-why">{why.join(' · ')}</span>
          </span>
          <span className="chev chev-toggle" aria-hidden="true" />
        </summary>

        <div className="funder-body">
          <dl className="funder-figures">
            {described ? (
              <>
                <div>
                  <dt>Typically</dt>
                  {/* The interquartile range, not the mean: the middle half of
                      what they gave is what "typical" honestly means, and a
                      mean is dragged around by one large grant. */}
                  <dd>
                    {gbp(funder.amounts.lowerQuartile)}–{gbp(funder.amounts.upperQuartile)}
                  </dd>
                </div>
                <div>
                  <dt>Median</dt>
                  <dd>{gbp(funder.amounts.median)}</dd>
                </div>
              </>
            ) : (
              <div>
                <dt>Too few to summarise</dt>
                <dd>
                  {funder.matching} grant{funder.matching === 1 ? '' : 's'} here — the
                  grants themselves are below
                </dd>
              </div>
            )}
            <div>
              <dt>Range</dt>
              <dd>
                {gbp(funder.amounts.min)}–{gbp(funder.amounts.max)}
              </dd>
            </div>
            <div>
              <dt>Last gave</dt>
              <dd>{when(funder.lastAwardedOn)}</dd>
            </div>
            <div>
              <dt>Published from</dt>
              <dd>
                {year(funder.firstAwardedOn)}
                {funder.lastAwardedOn === null ? '' : `–${year(funder.lastAwardedOn)}`}
              </dd>
            </div>
            {funder.commonTag === null ? null : (
              <div>
                <dt>Mostly labelled</dt>
                <dd>{funder.commonTag}</dd>
              </div>
            )}
          </dl>

          {funder.examples.length === 0 ? null : (
            <>
              <p className="funder-examples-label">
                Their most recent {funder.examples.length === 1 ? 'grant' : 'grants'} matching
                your search
              </p>
              <ul className="funder-examples">
                {funder.examples.map((example) => (
                  <li key={example.id}>
                    <span className="funder-example-amount">{gbp(example.amountGbp)}</span>{' '}
                    <span className="funder-example-when">{formatDate(example.awardedOn)}</span>
                    {example.recipientName === null ? null : <> · {example.recipientName}</>}
                    {example.title === null ? null : (
                      <span className="funder-example-title">{example.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="row-actions" style={{ marginTop: 'var(--s-4)' }}>
            <a
              className="btn btn-secondary"
              href={`/opportunities/add?funder=${encodeURIComponent(funder.funderId)}&funderName=${encodeURIComponent(funder.funderName)}`}
            >
              Add a fund from them
            </a>
            {funder.funderWebsite === null ? (
              <FindTheirPage funder={{ id: funder.funderId, name: funder.funderName }} />
            ) : (
              <a
                className="link-quiet"
                href={funder.funderWebsite}
                rel="noreferrer noopener"
                target="_blank"
              >
                Their website
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

export function FunderList({
  funders,
  context,
}: {
  funders: readonly FunderSummary[];
  context: FunderRankContext;
}) {
  return (
    <ul className="funders-grouped">
      {funders.map((funder) => (
        <Row context={context} funder={funder} key={funder.funderId} />
      ))}
    </ul>
  );
}
