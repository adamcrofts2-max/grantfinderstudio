/**
 * Companies House Public Data API shapes.
 *
 * As with every external source, every field is optional and unknown-typed:
 * we do not control this data and must not assume it is well formed.
 *
 * https://developer-specs.company-information.service.gov.uk/
 */

export interface RawAddress {
  address_line_1?: unknown;
  address_line_2?: unknown;
  locality?: unknown;
  region?: unknown;
  postal_code?: unknown;
  country?: unknown;
}

/** An item from GET /search/companies. */
export interface RawSearchItem {
  company_number?: unknown;
  title?: unknown;
  company_status?: unknown;
  company_type?: unknown;
  company_subtype?: unknown;
  date_of_creation?: unknown;
  address_snippet?: unknown;
  address?: unknown;
}

export interface RawSearchResponse {
  total_results?: unknown;
  items?: unknown;
}

/** GET /company/{number}. */
export interface RawCompanyProfile {
  company_name?: unknown;
  company_number?: unknown;
  company_status?: unknown;
  type?: unknown;
  subtype?: unknown;
  date_of_creation?: unknown;
  date_of_cessation?: unknown;
  jurisdiction?: unknown;
  registered_office_address?: unknown;
}
