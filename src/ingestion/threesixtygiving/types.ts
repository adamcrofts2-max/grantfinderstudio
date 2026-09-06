/**
 * The 360Giving Data Standard, as returned by https://api.threesixtygiving.org/api/v1/
 *
 * These types describe data we do not control. Every field is optional and
 * unknown-shaped, because a publisher can omit or malform anything, and a
 * connector that assumes otherwise fails at 3am rather than at parse time.
 */

export interface RawOrganisation {
  id?: unknown;
  name?: unknown;
}

export interface RawClassification {
  title?: unknown;
}

export interface RawLocation {
  name?: unknown;
  countryCode?: unknown;
  geoCode?: unknown;
}

export interface RawGrant {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  currency?: unknown;
  amountAwarded?: unknown;
  awardDate?: unknown;
  recipientOrganization?: unknown;
  fundingOrganization?: unknown;
  classifications?: unknown;
  beneficiaryLocation?: unknown;
}

/** Django REST Framework pagination, as the 360Giving API uses. */
export interface RawPage {
  count?: unknown;
  next?: unknown;
  results?: unknown;
}

/** Licence metadata that must travel with every record derived from a source. */
export interface SourceDataset {
  id: string;
  name: string;
  publisher: string;
  licence: string;
  licenceUrl: string | null;
  attribution: string;
  retrievedAt: string;
}
