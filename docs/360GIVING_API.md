# 360Giving API — reference

Written 8 September 2026. **The published documentation is unreachable from
this build environment** — every `360giving.org` and `threesixtygiving.org`
host is refused by the egress proxy (`CONNECT tunnel failed, 403`). So this
note was assembled from the project's own source, which is authoritative for
routes and shapes, plus search summaries of the doc pages for the policy
questions source cannot answer.

Sources:

- Routes, pagination and serialisers: `ThreeSixtyGiving/datastore` on GitHub
  (`datastore/api/urls.py`, `datastore/api/org/{api,serializers}.py`,
  `datastore/api/experimental/api.py`), branch `master`.
- Grant record shape: `ThreeSixtyGiving/standard`,
  `schema/360-giving-schema.json`.
- Auth, rate limit, licensing: 360Giving's own docs pages, via search.

**Confirm the live base path on the first real call.** The docs give
`https://api.threesixtygiving.org/api/v1/org/{org_id}/grants_received/`, while
the source mounts the same views under an `experimental/` prefix. One of the
two is stale and this environment cannot settle it.

## Access

| | |
|---|---|
| Base URL | `https://api.threesixtygiving.org/api/v1/` |
| Authentication | **None.** Read-only over open data; no key, no token |
| Rate limit | **2 requests per second per IP**; `429` beyond it |
| Format | HTTP/JSON, Django REST Framework |
| Interactive schema | `schema/`, `swagger-ui/`, `redoc/` |

## Pagination

`LimitOffsetPagination` on every list endpoint. Envelope:

```json
{ "count": 1234, "next": "…?limit=10&offset=20", "previous": null, "results": [] }
```

Default page sizes, from the source rather than the prose: **60** for grants
and for `CurrentLatestGrants`, **1000** for the organisation list. Follow
`next` until it is null rather than computing offsets.

## Endpoints

| Route | Returns |
|---|---|
| `org/` | Every organisation known to the data — funders, recipients and publishers alike. `org_id`, `name`, `self` |
| `org/{org_id}/` | Detail. `self`, `grants_made`, `grants_received`, `funder`, `recipient`, `publisher`, `org_id`, `name` |
| `org/{org_id}/grants_made/` | Grants this organisation awarded |
| `org/{org_id}/grants_received/` | Grants it received |
| `CurrentLatestGrants` | Every current grant. Supports `?search=` (regex over the whole grant JSON) and `?grant_id=` |
| `dashboard/publishers`, `dashboard/overview`, `dashboard/publisher/{prefix}` | Publisher statistics |

`funder` and `recipient` on the detail response are null unless the
organisation plays that role. Each carries an `aggregate`:

```
aggregate.grants                      total count
aggregate.currencies[CODE].{avg,max,min,total,grants}
```

**The aggregate has no median and no quartiles** — only mean, min, max and
total. Our funder distribution chart is built on the median and the
interquartile range, so those have to be computed from the grants themselves.

A grant record wraps the raw standard JSON in `data`, and adds `publisher`,
`recipients` and `funders` as organisation references with `self` links.

## The grant record

Required, from the schema's `oneOf`: `id`, `title`, `description`, `currency`,
`amountAwarded`, `awardDate`, `fundingOrganization`, and one of
`recipientOrganization` or `recipientIndividual`.

Also carried, and useful to us: `amountAppliedFor`, `amountDisbursed`,
`grantProgramme[]` (`code`, `title`, `url`), `classifications[]`
(`vocabulary`, `code`, `title`), `beneficiaryLocation[]`, `fundingType[]`,
`fromOpenCall`, `plannedDates`/`actualDates`, `dataSource`, `dateModified`.

`Organization` requires `id` and `name`, and may carry `charityNumber`,
`companyNumber`, `postalCode`, `addressRegion`, `addressCountry`,
`organisationType` and `url`. `Location` carries `countryCode`, `geoCode`,
`geoCodeType` and coordinates — that is where region matching comes from.

## Licensing

Publishers each choose an open licence; **CC BY 4.0 is the recommended one and
permits commercial use**. The licence and source travel with the data through
the API, so attribution is per-publisher rather than one blanket credit — which
is what `source_datasets(name, publisher, licence, attribution, retrieved_at)`
already models.

This settles a question left open by the earlier research: with openly licensed
data used under its own terms, the s29A CDPA text-and-data-mining exception —
which is non-commercial only — does not come into it.

Do not use the 360Giving logo without permission. There are API terms and
conditions and a take-down policy that should be read before going live; they
could not be retrieved here.

## What this means for the build

1. **It is a record of grants awarded, never of funds open.** Nothing in the
   schema carries a deadline or an application window; `fromOpenCall` describes
   a grant already made. So it powers "who funds work like yours" and must
   never feed the opportunities page.
2. **Ingestion is a batch job, not a page render.** Computing a median and
   quartiles means paging every grant a funder has made: 60 per request at 2
   requests a second is 25 seconds for a funder with 3,000 grants. That belongs
   in `funder_awards`, which already exists for it.
3. **A full corpus wants the bulk route, not this API.** Over a million grants
   at 60 a page and 2 a second is more than two hours of continuous requests.
   The Datastore (bulk transfer, Postgres over a Colab notebook) or the bulk
   downloads are the right tool for the whole corpus; this API is right for
   enriching one named funder on demand.
4. `amountAwarded`, `awardDate` and `currency` map straight onto
   `funder_awards`; `grantProgramme.title` and `classifications.title` are
   candidates for its `tags` column; recipient `addressRegion` and
   `beneficiaryLocation.countryCode` feed region matching.
