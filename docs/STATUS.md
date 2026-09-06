# STATUS

**Last updated:** 2026-09-06

## What exists

**496 tests, lint clean, typecheck clean, app builds.** `npm run verify` runs all four.

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

### Phase 3 — auth and tenancy (partial)
RBAC with lock-out invariants, and per-request tenant context that cannot outlive a request.
Sign-in and membership management endpoints are not built.

### Phase 5 — funder intelligence ✅
360Giving connector with pagination, dedupe, SSRF-checked page links and licence enforcement.
Normalisation rejects rather than repairs. Live verification against the real API is still
outstanding and blocked by this environment's egress allowlist.

### Phase 6 — discovery ✅
Assessment composing the three signals, honest deadline and freshness notices, the
"ask the funder" enquiry generator, and a working interface over the real schema.

**The application runs.** `npm run dev` serves a list of opportunities assessed against a
demonstration CIC, and a detail page showing eligibility per criterion, funder behaviour with
its licence and attribution, effort broken down by driver, and a draft enquiry when something
is unresolved. Demo data is fictional and the interface says so on every page.

### Phase 7 — the AI layer (foundation)
Provider abstraction (`claude-opus-5`, adaptive thinking, structured outputs), untrusted-content
fencing, a schema-validated runner, and the Extractor agent. Tested against scripted providers,
so the guarantees are verified without spending a token.

Three properties are enforced structurally rather than by prompting alone:
- **No vendor SDK outside `src/ai/providers`.** Everything else depends on an interface.
- **Extraction can only produce unconfirmed facts.** `confirmedBy` is hard-coded null in
  `toCandidateFacts`; there is no parameter that could make it otherwise.
- **No key means unavailable, never invented.** `createProvider` returns a reason rather than
  a stub that could answer.

## Not built yet

Authentication and sign-in · onboarding and natural-language intake · document upload, parsing
and embeddings · the Analyst, Writer and Critic agents · application workspace and drafting ·
red team · pipeline and deadlines · export · billing.

**The AI layer has now been verified live** against `claude-opus-5`. `extractor.live.test.ts`
runs the Extractor over a document carrying an embedded prompt-injection attempt and asserts
that every extracted fact quotes wording genuinely present in the source, that the injection is
reported rather than obeyed, that the injected figure is not adopted, and that nothing comes
back confirmed. It skips automatically without `ANTHROPIC_API_KEY`, so CI is unaffected.

That run found a bug the fixture tests could not: structured outputs reject `maxItems` on
arrays. The caps now live only in the zod parser.

## Environment constraints

- **Egress is allowlisted, but not uniformly.** `api.anthropic.com` IS reachable — a request
  with a bad key returns a real 401 — so the AI layer can be verified live as soon as a key is
  configured. `api.threesixtygiving.org`, `find-government-grants.service.gov.uk` and
  `api.company-information.service.gov.uk` return `connect_rejected`, so those connectors are
  still fixture-tested only and need live verification elsewhere.
- **No Postgres server, no Docker** — solved rather than worked around. PGlite runs real
  PostgreSQL compiled to WebAssembly in Node, including the genuine RLS policy engine, so
  tenant isolation is proven rather than asserted. It also backs the dev database the app
  runs against, so the interface exercises the real migrations and real policies. Production
  uses ordinary Postgres; the migrations are plain SQL and portable.
- **The bundler needs an extension alias.** Source uses ESM-correct `.js` specifiers pointing
  at `.ts` files, which TypeScript and Vitest resolve but Next's webpack does not. `next.config.mjs`
  teaches it the mapping rather than rewriting every import to a bundler-specific style.
- **The test suite takes ~60s** because each isolation test builds a fresh database. That is
  deliberate: sharing a database between tests that deliberately attempt cross-tenant writes
  would let one test's leakage mask another's.

## Deploying

See `docs/DEPLOYMENT.md`. You need a Postgres URL and an encryption key; the two
API keys are entered in the running app, not as environment variables.

With no `DATABASE_URL` the app runs on PGlite in memory — the same migrations and
the same RLS policies, but lost on restart. `/api/health` says so plainly rather
than letting it pass for a real deployment.

## Next task

Authentication, so the tenant context comes from a real session rather than a fixed demo
organisation id. Everything below it is already tenant-scoped and tested, so this is the last
piece before the app can hold more than one organisation.

After that, the AI layer: the provider abstraction and the four agents, starting with the
Extractor so onboarding can accept a plain-English description instead of seeded data.
