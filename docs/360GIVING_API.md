# The 360Giving Data Store API

**Read from source, not from a browser.** This document is a reading of
[`ThreeSixtyGiving/datastore`](https://github.com/ThreeSixtyGiving/datastore) at
commit `4a57c2e` — `datastore/api/urls.py`, `api/org/api.py`,
`api/experimental/api.py`, `api/org/serializers.py`, `db/models.py` and
`settings/settings.py`. The live service is unreachable from this build
environment, so source is the best evidence available; where source and the
live service disagree, the service wins and this document is wrong.

Two earlier versions of this file guessed at routes from half-remembered
documentation, and both guesses 404ed in production in front of the user. The
guessing is over: every route, parameter and limit below is quoted from a line
of their code.

## Base URL

```
https://api.threesixtygiving.org/api/v1/
```

Confirmed from their published documentation and consistent with
`datastore/urls.py` (`path("api/", include("api.urls"))`) plus the `v1/`
prefixes in `api/urls.py`.

**A 404 on the base itself proves nothing.** Django REST Framework serves a
root index only where a `DefaultRouter` is mounted, and 360Giving mount their
views with plain `path()` calls. There is no route index anywhere: `/api/`
serves an HTML landing page (`TemplateView`, `api.html`) and `/` serves their
web UI. Anything that tries to discover routes by reading an index will find
nothing, however far up it walks — which is how one version of our connector
came to spend three round trips producing a worse error message.

Authentication: none. Registration is requested but not enforced.

## Routes

### The public v1 API

| Route | What it gives |
| --- | --- |
| `org/` | Every organisation in the corpus — publishers, funders and recipients, unioned. `org_id` and `name` only. |
| `org/funder/` | The same, funders only. |
| `org/{org_id}/` | One organisation, split into `funder`, `recipient` and `publisher` sub-objects, each `null` where the organisation does not take that role. Carries aggregates: grant counts, earliest and latest award dates, and per-currency min/max/total. |
| `org/{org_id}/grants_made/` | Every current grant made by that funder. |
| `org/{org_id}/grants_received/` | Every current grant received by that recipient. |

`org_id` is a `<path:>` converter, so it may contain slashes; ours are of the
form `GB-CHC-1164883`. Both grant routes resolve linked organisations
(`org.linked_orgs`) before filtering, so an organisation that publishes under
several identifiers is handled by them, not by us.

### There is no public all-grants search

`/api/experimental/CurrentLatestGrants` is in their `urls.py` — with no `v1/`
and no trailing slash — and it **returns 404 on the live host**. Three
deployments confirmed it.

It is almost certainly not meant to be public. It sits in the same module as
`control/trigger-datagetter` and `control/abort-datagetter`, which start and
stop their data pipeline and plainly must not be reachable from outside; the
whole non-`v1` tree looks to be internal. `/api/` serves an HTML index page
that lists it, which is what a browser sees on the inside.

Their published documentation agrees, and this is the part to trust: it
describes exactly three data endpoints — **Grants Made, Grants Received,
Organisation List** — and no search.

So a search across grants is not something to ask this API for. Anything
built on that route is built on a 404.

### No text search on anything else

Worth stating plainly, because it shapes the product. `OrganisationListView`
and `FunderListView` declare no `filter_backends` and no search or filter
fields; the two grant routes declare `DjangoFilterBackend` but no
`filterset_fields`. A `?search=` or `?name=` on any of them is silently
ignored and the full list comes back. Finding a funder by name therefore means
fetching the organisation list and matching locally, not asking the API to
match.

## What this means for a product

Put together, the two sections above say: **the only way to search grants is to
hold them.** There is no route that searches grant text, and no route that
filters an organisation list by name. What there IS, generously rate-limited,
is every grant a named funder made.

That is also 360Giving's own advice to developers about their bulk data — store
it locally for your own application — so it is not a workaround. This product
therefore walks `org/funder/` for the names and `org/{id}/grants_made/` for the
grants, writes them to `funder_awards`, and searches that. See
`src/ingestion/threesixtygiving/corpus.ts`.

## Response shapes

Both differ, and confusing them is why one version of our connector read `null`
for every funder.

**The v1 grant routes** (`GrantSerializer`) give
`{ grant_id, data, data_license: { url, name }, publisher, recipients, funders }`,
where `publisher`, each `recipient` and each `funder` is an `OrganisationRef`:
`{ org_id, self }`.

**The search** (`CurrentLatestGrantSerializer`) is a `ModelSerializer` over
their `Grant` model excluding `id`, `getter_run`, `latest` and `source_file`,
so a row is:

```
{ grant_id, data, additional_data, publisher_org_id,
  recipient_org_ids: [...], funding_org_ids: [...] }
```

`data` is the 360Giving standard record as the publisher wrote it.

### Names come only from `data`

`OrganisationRef` is a dataclass holding `org_id` and nothing else. **No
endpoint names an organisation** on a grant. A funder's or recipient's name is
available only from inside the standard record — `data.fundingOrganization[].name`,
`data.recipientOrganization[].name`. A *publisher's* name is not available from
the grant routes at all, only its `org_id`.

### `additional_data`

360Giving's own enrichment, on search rows:

| Key | Contents |
| --- | --- |
| `metadata` | `source_license`, `source_license_name`, and `sources_metadata` (licences of the enrichment sources) |
| `recipientOrganizationLocation` | NSPL geography for the recipient's postcode — county, region and their names |
| `locationLookup` | Named areas with latitude and longitude |
| `TSGRecipientType` | `Organisation` or `Individual` |
| `TSGOrgType`, `FTC` | Organisation type, and Find That Charity data |

`metadata.source_license` is the one this product relies on: publishers each
choose their own open licence and **some are share-alike**, so there is no
single licence for the corpus. Attribution is read per grant from the row
rather than asserted by us.

## Limits

From `settings.py`:

| Scope | Rate |
| --- | --- |
| Anonymous default (covers the all-grants search) | **2 requests/second** |
| `org/` and `org/funder/` | 100/minute |
| `org/{id}/` | 1000/minute |
| `grants_made/`, `grants_received/` | 1000/minute |

Over the limit returns 429. Default page sizes: **60** for the search, **100**
for the grant routes, **1000** for the organisation lists.

Two requests a second is the reason the applicant's search fetches **one**
page. Walking pagination while somebody waits would turn a search into a
minute of held breath and a burst of load on an open API run by a charity.

## Pagination

`LimitOffsetPagination` throughout: `{ count, next, previous, results }`. The
`next` URL is server-controlled — a redirect in all but name — so it is checked
against the configured origin before being followed (`assertSameOrigin`).

## Licensing

Each publisher's licence travels with their grants, as above. This product does
not store searched grants: results are fetched for the person who asked, shown
with their licence, and discarded. Only the per-funder ingest writes grants to
`funder_awards`, and it refuses to run without a licence and an attribution.
