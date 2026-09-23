import { findTheirPage } from '@/domain/grants/find-their-page';

/**
 * The way on from a funder we hold no website for.
 *
 * Replaces a sentence that told people to go and search for the funder's name
 * — with no link — at exactly the moment they had found one worth
 * approaching. See `findTheirPage` for what each link is and why.
 */
export function FindTheirPage({
  funder,
  lead = null,
}: {
  funder: { id: string; name: string };
  /** Said before the links, e.g. why there is no website to offer. */
  lead?: string | null;
}) {
  const { search, register } = findTheirPage(funder);
  return (
    <span className="find-their-page">
      {lead === null ? null : <span className="hint">{lead} </span>}
      <a className="link-quiet" href={search.href} rel="noreferrer noopener" target="_blank">
        {search.label}
        <span className="sr-only"> — {funder.name} (opens in a new tab)</span>
      </a>
      {register === null ? null : (
        <>
          <span className="hint" aria-hidden="true"> · </span>
          <a className="link-quiet" href={register.href} rel="noreferrer noopener" target="_blank">
            {register.label}
            <span className="sr-only"> for {funder.name} (opens in a new tab)</span>
          </a>
        </>
      )}
    </span>
  );
}
