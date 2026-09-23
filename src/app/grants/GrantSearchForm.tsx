/**
 * The search box, as a plain GET form.
 *
 * A search belongs in the URL: bookmarkable, shareable with a colleague,
 * reloadable without resubmitting, and openable in a second tab. None of that
 * is true of a search held in component state. `q` records that the form has
 * been used, so a first visit can search for what the applicant does while an
 * emptied box afterwards stays empty.
 */
export function GrantSearchForm({
  text,
  suggested,
  derived,
}: {
  text: string;
  suggested: string;
  /** True when this search came from the applicant's own details. */
  derived: boolean;
}) {
  return (
    <form className="card" method="get" action="/grants" style={{ marginTop: 'var(--s-5)' }}>
      <input type="hidden" name="q" value="1" />

      <div className="field">
        <label className="label" htmlFor="grant-text">What sort of work, and where</label>
        <div className="row" style={{ gap: 'var(--s-3)', flexWrap: 'nowrap' }}>
          <input
            id="grant-text"
            className="input"
            name="text"
            defaultValue={text}
            placeholder="e.g. youth skills Somerset"
            style={{ minWidth: 0 }}
          />
          <button className="btn btn-primary" type="submit" style={{ flex: '0 0 auto' }}>
            Search
          </button>
        </div>
        <p className="hint">
          {derived && suggested !== ''
            ? `Searched for “${suggested}” from your own details. Change it to anything.`
            : 'Ordinary words, as a funder would write them — “young people” finds more than “youth engagement”.'}
        </p>
      </div>
    </form>
  );
}
