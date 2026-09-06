# STATUS

**Last updated:** 2026-09-06

## What exists

**160 tests, lint clean, typecheck clean.** `npm run verify` runs all three.

### Documentation
- `docs/PRODUCT_ARCHITECTURE.md` — product and technical analysis (Part 1)
- `docs/MASTER_IMPLEMENTATION_PROMPT.md` — the build specification (Part 2)

### Phase 0 — tooling ✅
TypeScript strict (`noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`), ES2023 target,
Vitest with v8 coverage thresholds, oxlint, GitHub Actions CI running lint → typecheck →
test → coverage. No UI framework yet, deliberately: the domain core stays free of framework
coupling.

### Phase 1 — domain core ✅
Pure TypeScript, zero I/O. **136 tests, 100% statement/branch/function/line coverage.**

| Module | What it does |
|---|---|
| `domain/types.ts` | Legal forms, jurisdictions, freshness, deadline types; predicates for asset lock, share capital, guarantee |
| `domain/eligibility/` | Deterministic rules engine over 10 criterion kinds. `unknown` is first-class and never coerced |
| `domain/effort/` | Application effort in hours from observable form features; value-per-hour recommendation |
| `domain/provenance/` | Append-only fact lifecycle, supersession, confirmation, claim grounding |
| `domain/budget/` | Budget validation against funder restrictions; reports every problem at once |
| `domain/readiness/` | Completeness scoring with blockers. Explicitly not a win probability |

### Phase 2 — persistence ✅
SQL migrations in `src/db/migrations/0001_init.sql`. **24 tenant-isolation tests passing
against real PostgreSQL.**

Two classes of table: tenant-scoped (RLS-protected) and shared reference data (funders,
opportunities, licences) readable by all tenants and writable only by the ingestion role.

## Design decisions worth remembering

- **Eligibility is a pure function.** AI proposes criteria; a human verifies; the engine
  decides. A wrong verdict is the worst failure mode, so it is the most-tested code here.
- **`evaluateEligibility` returns `unknown` for an empty criteria set.** Knowing nothing about
  a funder's rules is not the same as meeting them.
- **All CICs carry a statutory asset lock**, so `asset_locked_only` is unconditionally a pass
  on the CIC path — the case applicants most often misread as "charities only".
- **RLS uses both `USING` and `WITH CHECK`.** `USING` alone would let a tenant *insert* rows
  attributed to another tenant. There is a test for exactly that.
- **`FORCE ROW LEVEL SECURITY`** so even the table owner is subject to policy, and the test
  harness drops to an unprivileged `app_user` role — a superuser bypasses RLS entirely, so a
  test that forgot to switch roles would pass while proving nothing.
- **The system fails closed.** `current_setting('app.organisation_id', true)` returns NULL when
  unset, and `= NULL` is never true, so no tenant context means no rows. Tested.
- Effort constants (`EFFORT_CONSTANTS`) and value bands (`VALUE_THRESHOLDS`) are collected in
  one place so they can be tuned from real usage rather than scattered through the code.
- Facts are never mutated. `supersede()` returns both records; callers persist both.
- Only confirmed, non-superseded facts may ground generated prose (`isUsableForGeneration`).
- **SQL migrations are the schema source of truth**, not an ORM model. RLS policies cannot be
  expressed in a Drizzle schema, and the policies are the security boundary. Drizzle is
  deferred to Phase 3, where there are queries to type.

## Not built yet

Phases 3–11 of `docs/MASTER_IMPLEMENTATION_PROMPT.md`: auth and RBAC, onboarding, 360Giving
ingestion, opportunity index, document intelligence, application workspace, critic and red
team, pipeline, export. There is no UI at all yet.

## Environment constraints

- **Egress is allowlisted.** `api.threesixtygiving.org` and
  `find-government-grants.service.gov.uk` return `connect_rejected` from this container.
  Ingestion connectors must be written against recorded fixtures here and verified live
  elsewhere before any claim is made about coverage.
- **No Postgres server, no Docker** — solved rather than worked around. PGlite runs real
  PostgreSQL compiled to WebAssembly in Node, including the genuine RLS policy engine, so
  tenant isolation is proven rather than asserted. Production uses ordinary Postgres; the
  migrations are plain SQL and portable.
- **The test suite takes ~60s** because each isolation test builds a fresh database. That is
  deliberate: sharing a database between tests that deliberately attempt cross-tenant writes
  would let one test's leakage mask another's.

## Next task

Phase 3: authentication, organisations, memberships and RBAC — including the middleware that
sets `app.organisation_id` per request. That setting is what every RLS policy depends on, so
it needs its own tests: a request with no session must never leave a stale tenant context on a
pooled connection.
