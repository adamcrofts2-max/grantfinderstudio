import {
  bandsAroundAsk,
  filterCount,
  filtersToParams,
  hasFilters,
  isActive,
  toggle,
  type Dimension,
  type GrantFilters,
} from '@/domain/grants/facets';
import type { Facets, FacetOption } from '@/db/grants';

/**
 * Narrowing the results, as links rather than as a form.
 *
 * ## Why chips and not checkboxes
 *
 * A checkbox needs either a submit button or client-side JavaScript. A chip
 * that is an `<a>` needs neither: one tap, the URL carries the state, the back
 * button undoes it, and the narrowed search can be sent to a colleague as it
 * stands. On a phone — which is where this gets used — a wrapping row of chips
 * also beats a sidebar of checkboxes that has nowhere to live.
 *
 * ## Why every chip carries a count
 *
 * Because a filter without one is a trap: you tick it, you get nothing, and
 * you learn only that you wasted a tap. Each count answers "how many would I
 * get if I picked this" — computed with the other dimensions applied and this
 * one released — and an option that would leave nothing is not shown at all.
 *
 * ## Why these options and not a fixed taxonomy
 *
 * The topics and places are the publishers' own words, and there are two
 * hundred publishers. The options are therefore taken from the results in
 * front of you rather than from a list we invented: the handful that actually
 * occur, not the four hundred that might.
 *
 * ## Why it is folded away
 *
 * Four rows of chips is most of a phone screen. Opened by default it pushed
 * every result below the fold, so somebody who had just searched saw filters
 * instead of grants — the wrong thing first. It opens by itself once anything
 * is active, and whatever IS active shows in the summary either way, so a
 * filter can never be on without being visible.
 */

/**
 * The address this chip goes to: the search, with this one value flipped.
 *
 * `base` carries ONLY the non-filter parameters — the query itself — so the
 * filter half of the URL is rebuilt from the toggled state every time. An
 * earlier version spread the whole query string and then deleted the keys it
 * did not want, which put a filter back the moment somebody turned it off.
 */
function searchHref(base: Record<string, string>, filters: GrantFilters): string {
  return `/grants?${new URLSearchParams({ ...base, ...filtersToParams(filters) }).toString()}`;
}

function chipHref(
  base: Record<string, string>,
  filters: GrantFilters,
  dimension: Dimension,
  value: string,
): string {
  return searchHref(base, toggle(filters, dimension, value));
}

function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <a
      className={active ? 'chip chip-on' : 'chip'}
      href={href}
      aria-pressed={active}
      rel="nofollow"
    >
      <span>{label}</span>
      {count === undefined ? null : (
        <span className="chip-count">{count.toLocaleString('en-GB')}</span>
      )}
      {active ? <span aria-hidden="true">×</span> : null}
      {active ? <span className="sr-only">— tap to remove this filter</span> : null}
    </a>
  );
}

function Row({
  title,
  hint,
  options,
  dimension,
  base,
  filters,
}: {
  title: string;
  hint?: string;
  options: readonly FacetOption[];
  dimension: Dimension;
  base: Record<string, string>;
  filters: GrantFilters;
}) {
  if (options.length === 0) return null;
  return (
    <div className="narrow-row">
      <p className="narrow-label" id={`narrow-${dimension}`}>
        {title}
        {hint === undefined ? null : <span className="narrow-hint"> {hint}</span>}
      </p>
      <div className="chips" role="group" aria-labelledby={`narrow-${dimension}`}>
        {options.map((option) => (
          <Chip
            active={isActive(filters, dimension, option.value)}
            count={option.count}
            href={chipHref(base, filters, dimension, option.value)}
            key={option.value}
            label={option.label}
          />
        ))}
      </div>
    </div>
  );
}

export function Narrow({
  facets,
  filters,
  base,
  amountSoughtGbp,
}: {
  facets: Facets;
  filters: GrantFilters;
  base: Record<string, string>;
  /** What the applicant said they need, for the one-tap band around it. */
  amountSoughtGbp: number | null;
}) {
  const nothingToNarrow =
    facets.amount.length + facets.since.length + facets.place.length + facets.topic.length === 0;
  if (nothingToNarrow && !hasFilters(filters)) return null;

  /**
   * One tap for the filter most people want first.
   *
   * Half to double their ask, which nobody assembles correctly by hand from a
   * list of bands. Only offered when they have told us what they need and when
   * it is not already what is selected.
   */
  const askBands = bandsAroundAsk(amountSoughtGbp);
  const askActive =
    askBands.length > 0 &&
    askBands.length === filters.bands.length &&
    askBands.every((band) => filters.bands.includes(band));
  const askHref = searchHref(base, { ...filters, bands: askActive ? [] : askBands });
  const clearHref = searchHref(base, { bands: [], since: null, places: [], topics: [] });
  const active = filterCount(filters);

  return (
    <details className="narrow" open={active > 0}>
      <summary className="narrow-summary">
        <span>
          {active === 0 ? 'Narrow these results' : `Narrowed by ${active} filter${active === 1 ? '' : 's'}`}
          <span className="narrow-hint">
            {' '}
            {active === 0 ? 'by size, when, where or what for' : '— tap a filter again to remove it'}
          </span>
        </span>
        <span className="chev chev-toggle" aria-hidden="true" />
      </summary>

      <div className="narrow-body">
      {askBands.length === 0 ? null : (
        <div className="narrow-row">
          <p className="narrow-label" id="narrow-ask">
            Start here
          </p>
          <div className="chips" role="group" aria-labelledby="narrow-ask">
            <Chip
              active={askActive}
              href={askHref}
              label={`About what we need (£${amountSoughtGbp?.toLocaleString('en-GB')})`}
            />
          </div>
        </div>
      )}

      <Row
        base={base}
        dimension="amount"
        filters={filters}
        options={facets.amount}
        title="Size of grant"
      />
      <Row
        base={base}
        dimension="since"
        filters={filters}
        hint="a funder who has not given for years is not a prospect"
        options={facets.since}
        title="Still giving"
      />
      <Row
        base={base}
        dimension="place"
        filters={filters}
        hint="as the funder wrote it"
        options={facets.place}
        title="Where the money went"
      />
      <Row
        base={base}
        dimension="topic"
        filters={filters}
        hint="each funder’s own labels, so they vary"
        options={facets.topic}
        title="What it was for"
      />

      {active === 0 ? null : (
        <p className="narrow-clear">
          <a className="link-quiet" href={clearHref} rel="nofollow">
            Clear {active} filter{active === 1 ? '' : 's'}
          </a>
        </p>
      )}
      </div>
    </details>
  );
}
