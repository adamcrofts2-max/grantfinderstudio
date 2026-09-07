# STATUS

**Last updated:** 2026-09-06

## What exists

**530 tests, lint clean, typecheck clean, app builds.** `npm run verify` runs all four.

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
- **The tracker schedules backwards, not forwards.** A deadline tells a user nothing they did
  not know; the last day they can still *start* is the number nobody has. `latestStartDate`
  works back from the deadline through the writing still outstanding at the organisation's
  weekly capacity (`SCHEDULE_CONSTANTS.defaultHoursPerWeek`, currently 4 and shown to the user
  as an assumption). This is why the tracker is a scheduling surface rather than a calendar.
- **Effort is priced at the rate the work is actually done.** Writing a grant answer from a
  blank box and checking a draft the Writer has already grounded in confirmed facts are not the
  same task, so `EFFORT_CONSTANTS` carries two rates: `wordsPerHour` (200) and
  `assistedWordsPerHour` (700, a substantive-editing rate — the work is checking each claim, not
  reading the words). Pricing every hour as unassisted composition understated the product's own
  point and sent people away from funds they could comfortably complete; there is a test for
  exactly that reversal.
- **The assisted rate is claimed only when it is true.** `draftingMode` requires both a usable
  Anthropic key — stored *and* passing its last check, or supplied as `ANTHROPIC_API_KEY`, which
  is how a deployment configures itself — and at least `MIN_FACTS_FOR_ASSISTED_DRAFTING` (5)
  confirmed facts, because the Writer refuses to invent and cannot draft from nothing. Erring
  towards the slower number costs an afternoon; erring towards the faster one costs a deadline.
  `src/app/drafting.ts` is the single answer, shared by the tracker, the calendar export and the
  opportunity assessment, so the three can never disagree about how fast the work goes.
- **Assisted drafting creates a cost as well as removing one.** Every claim the Writer could not
  ground is a real outstanding task — find the evidence, confirm the fact, or cut the sentence —
  priced at `hoursPerUnsupportedClaim`. The workspace already counts these exactly, so it is
  measured rather than assumed, and a form with every question answered but four unevidenced
  claims correctly reads as unfinished.
- **What is left, once the writing collapses, is paperwork.** Attachments, policies, accounts,
  match funding and the funder's budget template are untouched by drafting help, and on a form
  with real paperwork they become the majority of the remaining cost. That is what an applicant
  should be planning around, and the effort drivers are sorted to make it visible.
- **Unknown work is reported as unknown.** `remainingHours` returns `null` when no questions
  have been pasted in — an unmeasured form is not an empty one, and a confident schedule on top
  of no information is worse than saying "paste the questions in".
- **Eligibility overrides urgency in the tracker.** A fund the engine has ruled you out of is
  moved to "Ruled out" and its schedule suppressed, whatever its deadline says. Urging someone
  to drop everything for a fund they cannot win is the product arguing with itself, and the
  fastest way to teach people to ignore it. It is set aside, never hidden — the applicant may
  know something about the funder that we do not.
- **Reminders go to the user's own calendar, not to a notification channel we build.** The
  architecture cut notifications because alerting over a thin opportunity feed manufactures
  noise; that reasoning holds for *discovery*. A person's own committed deadlines are real,
  user-entered data, and they already own something that reminds them reliably. So the tracker
  exports iCalendar (deadlines and start dates, with alarms) rather than growing a mail
  provider, a scheduler and an unauthenticated feed token. A download, not a subscribable feed:
  a feed URL must be fetchable by Google's servers without a session, and inventing an
  unauthenticated token for tenant data is not a decision to make in passing.
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
red team · export · billing.

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

## The journey that now works end to end

Find your company on Companies House → confirm what we know about you →
see opportunities assessed against you → start an application → paste the
funder's questions → draft each answer from confirmed facts → copy it into
their portal → track what is left against the time you actually have, and put
the dates in your own calendar → mark it submitted, which stops its clock.

What is missing from that line: document upload (the Extractor exists but
nothing feeds it), budgets, outcomes, and DOCX export.

## The tracker (Phase 10)

`src/domain/tracker/schedule.ts` is pure scheduling arithmetic: `remainingHours` sizes the
writing left from the pasted questions (word limits where the funder gave one,
`assumedWordsPerUnlimitedQuestion` where it did not, and the one-off cost of reading the
guidance only while nothing is answered); `daysOfWorkNeeded` converts that to calendar days at
the weekly pace; `latestStartDate` subtracts it, plus a two-day buffer, from the deadline. The
result is one of seven states — `overdue`, `start_now`, `behind`, `effort_unknown`, `on_track`,
`no_clock`, `submitted` — each carrying a plain-English reason built from the numbers. No
score, for the same reason `assess.ts` refuses a composite. `dateIsFirm` travels with every
judgement so an estimated deadline never generates confident urgency, and a rolling fund is
`no_clock` even when a date is recorded against it.

`src/domain/tracker/calendar.ts` renders iCalendar: CRLF, RFC 5545 escaping, 75-octet folding
that never splits a multi-byte character, all-day events with an exclusive end date, stable
UIDs so re-importing updates rather than duplicates, and a `VALARM` a week before each deadline
and a day before each start date. An unconfirmed date says so in the SUMMARY, not just the
description — the summary is all most people see in a month view.

`src/db/tracker.ts` is the read model. It returns applications *and* the opportunities with no
application against them, because the second group is where deadlines are actually missed. The
`NOT EXISTS` check is scoped by RLS, so a fund another tenant is working on still reads as
untouched here; there is a test for exactly that.

`/tracker` groups by what the work needs (Needs you this week · In hand · No fixed deadline ·
Not started · Ruled out · Submitted) rather than by calendar bucket, because the question a
user arrives with is "what do I do today", not "what happens in October".
`/api/tracker/calendar` serves the `.ics`.

## Next task

Authentication, so the tenant context comes from a real session rather than a fixed demo
organisation id. It now also gates two tracker follow-ups: a subscribable calendar feed, and
weekly capacity as a per-organisation setting rather than the 4h/week assumption. Everything below it is already tenant-scoped and tested, so this is the last
piece before the app can hold more than one organisation.

After that, the AI layer: the provider abstraction and the four agents, starting with the
Extractor so onboarding can accept a plain-English description instead of seeded data.
