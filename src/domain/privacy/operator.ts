/**
 * The facts about the publisher that only the publisher knows.
 *
 * ## Why these are null and not a plausible default
 *
 * Everything else in the privacy notice is derived from the schema and can be
 * checked against it. These cannot: nothing in this repository knows the legal
 * name of the company running it, where it is registered, or which address
 * answers a request for erasure. A notice that invented them would be a
 * document that looks complete and names the wrong entity — worse than an
 * obvious blank, because nobody would go looking.
 *
 * So they are null until somebody who knows fills them in, the page says
 * plainly that it is not ready to publish while any are, and
 * `operator.test.ts` fails if the page ever stops saying so.
 *
 * ## What each is for
 *
 * `legalName`, `registeredAddress` and `icoRegistration` identify the
 * controller. `contactEmail` is where a request under the UK GDPR goes.
 * `hostedIn` is the one fact about where the data physically sits, which
 * cannot be read off the code because it depends on how the database is
 * provisioned.
 */

export interface Publisher {
  /** The company that decides what happens to the data. */
  legalName: string | null;
  registeredAddress: string | null;
  /** The ICO registration number, if the controller has one. */
  icoRegistration: string | null;
  /** Where a request about data goes. */
  contactEmail: string | null;
  /** Where the database physically lives, e.g. "London (AWS eu-west-2)". */
  hostedIn: string | null;
}

/**
 * Fill these in before the notice is published.
 *
 * Deliberately a plain constant rather than an environment variable: these
 * belong in version control, where a change to who controls the data is a
 * commit somebody can see, rather than a setting somebody can change without
 * anyone noticing.
 */
export const PUBLISHER: Publisher = {
  legalName: null,
  registeredAddress: null,
  icoRegistration: null,
  contactEmail: null,
  hostedIn: null,
};

/** What each blank is called when the page lists what is missing. */
const BLANK_LABELS: Record<keyof Publisher, string> = {
  legalName: 'the legal name of the company running this',
  registeredAddress: 'its registered address',
  icoRegistration: 'its ICO registration number',
  contactEmail: 'an address a data-protection request can be sent to',
  hostedIn: 'where the database physically lives',
};

/** Which facts are still missing, in the words the page uses. */
export function blanks(publisher: Publisher = PUBLISHER): string[] {
  return (Object.keys(BLANK_LABELS) as Array<keyof Publisher>)
    .filter((key) => {
      const value = publisher[key];
      return value === null || value.trim() === '';
    })
    .map((key) => BLANK_LABELS[key]);
}

/**
 * Whether this notice is fit to publish.
 *
 * Not a style question. A privacy notice that does not name its controller
 * does not do the one job the law gives it, so the page carries a banner
 * saying so for as long as this is false.
 */
export function readyToPublish(publisher: Publisher = PUBLISHER): boolean {
  return blanks(publisher).length === 0;
}
