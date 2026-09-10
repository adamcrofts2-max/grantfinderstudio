import type { GrantSearchCriteria } from '@/domain/grants/search';

/**
 * The filters, as a plain GET form.
 *
 * No client component and no action: a search belongs in the URL. It can be
 * bookmarked, shared with a colleague, reloaded without resubmitting, and
 * opened in a second tab — none of which is true of a search held in component
 * state. `q` marks that the form has been used, so a first visit can land on
 * "grants like mine" while a cleared field afterwards stays cleared.
 */
export function GrantFilters({
  criteria,
  tags,
  regions,
  derived,
}: {
  criteria: GrantSearchCriteria;
  tags: string[];
  regions: string[];
  /** True when these filters came from the applicant's own profile. */
  derived: boolean;
}) {
  return (
    <form className="card" method="get" action="/grants" style={{ marginTop: 'var(--s-5)' }}>
      <input type="hidden" name="q" value="1" />

      {derived ? (
        <p className="notice notice-neutral" style={{ marginBottom: 'var(--s-4)' }}>
          <span aria-hidden="true">◆</span>
          <span>
            Starting from your own details — your area, what you do and around the size you are
            asking for. Change anything below, or clear it all to see every grant held.
          </span>
        </p>
      ) : null}

      <div className="fields-2">
        <div className="field">
          <label className="label" htmlFor="grant-text">What the money was for</label>
          <input
            id="grant-text"
            className="input"
            name="text"
            defaultValue={criteria.text}
            placeholder="youth skills, repair cafe, roof"
          />
          <p className="hint">Searches the recipient&rsquo;s name and the funder&rsquo;s own description.</p>
        </div>

        <div className="field">
          <label className="label" htmlFor="grant-region">Area</label>
          <input
            id="grant-region"
            className="input"
            name="region"
            defaultValue={criteria.region}
            list="grant-regions"
            placeholder="Somerset"
          />
          <datalist id="grant-regions">
            {regions.map((region) => (
              <option key={region} value={region} />
            ))}
          </datalist>
          <p className="hint">As the funder wrote it, so a partial name works.</p>
        </div>
      </div>

      <div className="fields-3" style={{ marginTop: 'var(--s-4)' }}>
        <div className="field">
          <label className="label" htmlFor="grant-tag">Kind of work</label>
          <input
            id="grant-tag"
            className="input"
            name="tag"
            defaultValue={criteria.tag}
            list="grant-tags"
            placeholder="Children and young people"
          />
          <datalist id="grant-tags">
            {tags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label className="label" htmlFor="grant-min">At least</label>
          <input
            id="grant-min"
            className="input"
            name="min"
            inputMode="numeric"
            defaultValue={criteria.minAmountGbp ?? ''}
            placeholder="5000"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="grant-max">At most</label>
          <input
            id="grant-max"
            className="input"
            name="max"
            inputMode="numeric"
            defaultValue={criteria.maxAmountGbp ?? ''}
            placeholder="50000"
          />
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--s-5)' }}>
        <button className="btn btn-primary" type="submit">Search grants</button>
        <a className="btn btn-secondary" href="/grants?q=1">Clear filters</a>
      </div>
    </form>
  );
}
