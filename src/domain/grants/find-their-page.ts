/**
 * Where to look for a funder's page when we hold no website for them.
 *
 * ## The dead end this closes
 *
 * 360Giving records what a funder gave, and often not where they are on the
 * web. So the trail went cold at the most useful moment: a funder that gave
 * £15k to work like yours, in your county — and then "No website published in
 * their grant data, so search for their name", as a sentence, with no link.
 * The applicant was told to go and do the search the product could have
 * started for them.
 *
 * Two routes, both opened by the person, in a new tab:
 *
 *  - A web search for their funding page — the name in quotes, with the words
 *    a funding page uses. Always available.
 *  - Their entry on Find that Charity, when the 360Giving identifier is a
 *    charity or company register number. It is the 360Giving community's own
 *    lookup, keyed on exactly the identifier we hold, and it shows the
 *    registered details — usually including the website — from the register
 *    itself rather than from a search engine's guess.
 *
 * Nothing is fetched on the person's behalf: the product sends nobody the
 * funder's name, the person's browser does, when they choose to follow a link.
 *
 * Pure and zero I/O, like the rest of the domain.
 */

/** Our funder ids for 360Giving funders: this prefix, then their org-id. */
const THREESIXTY_PREFIX = 'funder_360g_';

/**
 * Register identifiers Find that Charity resolves, by org-id scheme: charity
 * registers for England and Wales, Scotland and Northern Ireland, and
 * Companies House. Anything else — including the stub funders the tests use,
 * whose ids only look like these — gets the search alone.
 */
const REGISTER_ID = /^GB-(?:CHC-\d{6,7}|SC-SC\d{6}|NIC-\d{6}|COH-[A-Z0-9]{8})$/u;

export interface OutboundLink {
  label: string;
  href: string;
}

export interface FindTheirPage {
  search: OutboundLink;
  register: OutboundLink | null;
}

/** The funder's org-id, if the id is one of ours for a 360Giving funder. */
export function orgIdOf(funderId: string): string | null {
  if (!funderId.startsWith(THREESIXTY_PREFIX)) return null;
  const orgId = funderId.slice(THREESIXTY_PREFIX.length).trim();
  return orgId === '' ? null : orgId;
}

export function findTheirPage(funder: { id: string; name: string }): FindTheirPage {
  // Quoted, so a funder called "The Wells Trust" is not every trust in Wells.
  // Stray quotes in the name would unbalance that, so they go.
  const name = funder.name.replaceAll('"', '').trim();
  const query = `"${name}" grants how to apply`;
  const orgId = orgIdOf(funder.id);
  return {
    search: {
      label: 'Search for their funding page',
      href: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    },
    register:
      orgId !== null && REGISTER_ID.test(orgId)
        ? {
            label: 'Their registered details',
            href: `https://findthatcharity.uk/orgid/${encodeURIComponent(orgId)}`,
          }
        : null,
  };
}
