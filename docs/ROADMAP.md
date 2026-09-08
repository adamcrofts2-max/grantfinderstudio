# ROADMAP

Ordered by phase. Tick only what genuinely shipped — built, tested, verified.

## Phase 0 — Tooling
- [x] TypeScript strict configuration
- [x] Vitest with coverage thresholds
- [x] Path alias `@/*`
- [x] Lint (oxlint)
- [x] CI workflow running lint, typecheck, test, coverage

## Phase 1 — Domain core (pure, no I/O)
- [x] Shared domain vocabulary and legal-form predicates
- [x] Deterministic eligibility engine, 10 criterion kinds
- [x] CIC treatment patterns (6 patterns + not-stated)
- [x] `unknown` as a first-class, never-coerced outcome
- [x] Effort model with explainable drivers
- [x] Value-per-hour recommendation
- [x] Fact lifecycle: confirmation, supersession, append-only
- [x] Claim grounding with unsupported-claim detection
- [x] 100% branch coverage on executable domain code
- [x] Budget validation against funder restrictions
- [x] Application readiness scoring (completeness, not win probability)

## Deployment
- [x] Postgres adapter with transaction-local role and tenant context
- [x] Migration runner, tracked and safe to re-run
- [x] Environment validation reporting every problem at once
- [x] Health check endpoint
- [x] Vercel config with security headers, UK region
- [x] Rehearsed against real PostgreSQL 16 as a non-superuser owner
- [x] Idempotent, cluster-safe `app_user` role creation with explicit membership
- [x] First run works on an empty database: manual profile entry and project
- [x] Demo-data banner shown only when there is demo data
- [ ] Deploy and verify Companies House and 360Giving against their real APIs
- [ ] Deployment protection on, until authentication exists

## Phase 2 — Persistence
- [x] SQL schema covering the MVP tables, with enums and check constraints
- [x] Migrations (`src/db/migrations`)
- [x] Row-Level Security on every tenant-scoped table, with `WITH CHECK`
- [x] Automated cross-tenant isolation tests against real Postgres (PGlite/WASM)
- [x] `source_datasets` table carrying licence and attribution
- [x] Read models joining opportunities, funders, criteria and licences
- [x] Dev database on PGlite running the real migrations and RLS
- [ ] pgvector extension and `document_chunks.embedding`
- [ ] Licence enforcement at export time (it is displayed, not yet gated)

## Phase 3 — Auth and tenancy
- [x] Operator settings screen for service credentials (encrypted, verified)
- [x] Privileged `withAdmin` path, separate from every tenant connection
- [x] RBAC (owner/admin/editor/viewer) with lock-out invariants
- [x] Per-request tenant context via transaction-local `set_config`
- [x] Tests proving the context cannot outlive a request
- [ ] Authentication (sessions, sign-in)
- [ ] Organisation and membership management endpoints
- [ ] Audit logging on privileged actions

## Phase 4 — Onboarding
- [x] Companies House search by name, with company-number lookup as a fallback
- [x] CIC guarantee/shares distinction read from the register, never guessed
- [x] Dissolved companies flagged before any effort is spent
- [x] Adopting a company writes facts with `companies_house` provenance
- [x] Graceful degradation when lookup is unconfigured or unavailable
- [x] Manual entry, recorded as self-declared rather than verified
- [ ] Live verification against the real Companies House API (egress-blocked here)
- [ ] Natural-language intake ("What are you trying to fund?")
- [ ] Fact confirmation UI with source spans

## Phase 5 — Funder intelligence
- [x] 360Giving connector with pagination, dedupe and SSRF-checked page links
- [x] Normalisation that rejects rather than repairs (non-GBP, bad amounts/dates)
- [x] Untrusted-text handling at the ingestion boundary
- [x] Funder behaviour summaries (quartiles, recency, region and tag tallies)
- [x] Refusal to ingest a dataset with no licence or attribution
- [ ] Live verification against the real API (blocked: egress allowlist)
- [ ] Persisting awards and licence to the database
- [ ] Licence rendering in the UI and export gating

## Phase 6 — Discovery
- [x] Assessment composing the three signals, with no composite score
- [x] Honest deadline and freshness notices (an estimate cannot read as confirmed)
- [x] "Ask the funder" enquiry generator (deterministic, invents nothing)
- [x] Opportunity index queries over the database
- [x] Results UI showing the three signals, ordered by whether it is worth the time
- [x] Effort display with its drivers broken out
- [x] Criteria row mapper that rejects rather than silently loses a bound
- [ ] Natural-language intake (needs the AI layer)
- [ ] Saving and filtering opportunities

### Phase 6a — The applicant brings the fund (Sept 2026 research pass)
Research finding: no machine-readable source of open UK trust and foundation
calls exists, and none is coming. Find a Grant is ~120 grants and central
government only; 360Giving is awarded grants by design; incumbents use human
researchers. So the opportunity pipeline starts with the applicant pasting the
funder's own guidance. See `PRODUCT_ARCHITECTURE.md` §2.3.1.

- [x] Paste a funder's guidance and turn it into an assessable opportunity
- [x] Analyst agent proposing eligibility criteria from that guidance
- [x] Every proposed criterion verified by a person before the engine uses it
      (`loadCriteria` filters on `verified_at`; that filter is the gate)
- [x] Opportunity provenance: user-supplied is a source type, never dressed up
      as a verified register entry
- [x] Deadline and amounts extracted, with `deadline_kind` set honestly
- [x] A pasted fund is private to the organisation that added it (RLS)
- [x] Effort reported as unknown when nobody has seen the funder's form
- [x] Preferences are not proposed as criteria — only stated requirements
- [ ] Edit a proposed criterion rather than only accepting or rejecting it
- [ ] Re-read a fund when its guidance changes, diffing against what is verified
- [x] 360Giving as a prospect engine: which funders fund work like mine, at
      what size, and how recently
- [x] Tiers with stated, countable definitions rather than a similarity score
- [x] Every tier earned by grants the user can open and read
- [x] Award classification tags stored, so cause matching can actually fire
- [ ] Ingest real 360Giving data into funder_awards (connector exists; blocked
      on egress here, so first run is on deployment)
- [ ] "Is this funder open?" — targeted search against a named prospect, fetched
      on demand and fed into the existing paste-a-fund review screen
- [ ] Charity Commission API for funder financials and filing status
- [ ] Find a Grant connector (demoted: small, central government only)

## Phase 7 — Document intelligence
- [x] AI provider abstraction; no vendor SDK outside `src/ai/providers`
- [x] Untrusted-content fencing with a per-call random marker
- [x] Schema-validated agent runner with one retry, then visible failure
- [x] Extractor agent producing candidate facts that are never confirmed
- [x] Upload, parse and chunk documents (PDF, .docx, text, Markdown)
- [x] Extracted text stored, original bytes deliberately not retained
- [x] Extractor wired to real uploads, landing candidate facts unconfirmed
- [x] Reconciliation: duplicates dropped, conflicts surfaced against what is held
- [x] Controlled claim vocabulary, so the same fact does not arrive under two names
- [x] Injection attempts surfaced to the user rather than swallowed
- [ ] Detect a byte-identical re-upload before spending a model call on it
- [ ] Resolve a conflict in one click (supersede the old value from the review screen)
- [ ] OCR for scanned PDFs with no text layer
- [ ] Embeddings and retrieval
- [x] Live verification against the real API, including prompt injection
- [ ] Prompt-injection eval corpus run in CI

## Phase 8 — Application workspace
- [x] Writer agent drafting from confirmed facts only
- [x] Per-sentence fact citation, verified against the supplied facts
- [x] Gaps recorded instead of figures invented
- [x] Deterministic checks: fabricated citation, unsupported claim, word limit, repetition
- [x] Live-verified, including refusing to invent a number it was asked for
- [x] Question intelligence ("what they are really asking") shown before drafting
- [x] Workspace wiring the Writer to real questions
- [x] Per-claim provenance stored and displayed, unsupported sentences highlighted
- [x] Gaps surfaced as questions for the applicant
- [x] Fact confirmation screen — nothing grounds an application until a person says so
- [x] Readiness from real answer state
- [x] Paste questions from a funder's portal, with word limits pulled out
- [x] Copy an answer as plain text, warning when a claim is unsupported
- [x] Copy the whole application as question-and-answer text
- [ ] Export to DOCX/PDF (for internal review and email-attachment funders)
- [x] Start an application from any opportunity, eligibility-aware but never blocking
- [x] Applications pipeline ordered by deadline

## Phase 9 — Review, and the path to paid human review
Sequenced so each step is useful alone and earns the right to the next. A
marketplace built first is a bet; built last it is an obvious extension.

**Step 1 — the machine catches the mechanical faults (free)**
- [x] Critic agent: reads the whole application as an assessor would
- [x] Red-team mode: the same read, adversarially
- [x] Findings quote the span they refer to, so each one is checkable
- [x] Findings quoting words the application does not contain are discarded
- [x] The Critic never rewrites, never scores, and never repeats a check the
      deterministic `checkDraft` already makes exactly
- [ ] Store reviews against the application (the `reviews` table is still unused)
- [ ] Readiness breakdown (completeness, never a success probability)

**Step 2 — a human of the applicant's choosing (free, no supply side needed)**
- [ ] Share an application read-only for review: answers, the evidence behind
      every claim, unsupported-claim flags, the eligibility verdict
- [ ] Structured comments a reviewer can leave against a specific answer
- [ ] Scoped, time-boxed, revocable, audited access — a named outsider reading
      tenant data is a deliberate GDPR processor relationship, not a toggle
- [ ] Decide whether a reviewer's sign-off is recorded as provenance or stays
      advisory (leaning: recorded — a reviewer's judgement is the strongest
      provenance the product could carry)

**Step 3 — curated referral (revenue, no platform liability)**
- [ ] A short list of vetted bid writers; they contract directly with the CIC
- [ ] Referral fee rather than a take rate, so no payments stack is needed

**Step 4 — marketplace, only if steps 2 and 3 show the volume**
- [ ] Two-sided matching, vetting, ratings, disputes, DPAs with every reviewer
- [ ] Note the identity shift: software margins become services margins, and
      headcount starts scaling with revenue

- [ ] Budget engine
- [ ] Outcomes table

## Phase 10 — Tracker, pipeline and export
- [ ] Pipeline states
- [x] Deadline tracking with honest deadline types
- [x] Latest-start-date scheduling from remaining effort and weekly capacity
- [x] Tracker groups work by what it needs, not by calendar bucket
- [x] Eligibility overrides urgency — a ruled-out fund is set aside, not chased
- [x] Mark an application submitted (and undo it), which stops its clock
- [x] iCalendar export: deadlines and start dates into the user's own calendar
- [x] Effort priced at the rate the work is actually done — drafting with the Writer, or unaided
- [x] Assisted rate claimed only when the Writer is genuinely usable (key present and working,
      enough confirmed facts to ground prose in)
- [x] Unsupported claims counted as outstanding work: assisted drafting creates them
- [ ] Calibrate the assisted rate against real usage rather than a trade heuristic
- [ ] Weekly capacity as a per-organisation setting rather than a 4h/week assumption
- [ ] Subscribable calendar feed (needs auth: a feed URL is fetched without a session)
- [ ] Track a fund without opening an application for it (an explicit watchlist)
- [ ] Effort features beyond word counts (attachments, policies, match funding) per opportunity
- [ ] DOCX/PDF export

## Phase 11 — Hardening
- [ ] Upgrade vitest/vite (dev-only advisories: esbuild dev server, postcss via next)
- [ ] WCAG 2.2 AA audit with automated axe in CI
- [ ] Security review
- [ ] AI evaluation suite
- [ ] Performance

### Discovery: what we will not build
Established by the September 2026 research, and by a second look at the legal
position:

- **No crawled index of funder pages.** The UK kept the sui generis database
  right; systematic extraction of a substantial part infringes even when each
  extraction is small and the data is factual. Most funder terms prohibit
  automated access. The text-and-data-mining exception (s29A CDPA) is
  non-commercial research only, so a commercial product is outside it.
- **What is defensible instead:** a licensed search index, a page fetched on
  demand for the user who asked, extracted facts and a link rather than a copy,
  kept private to that tenant. The last part is already true of a pasted fund —
  built as a privacy decision, and it turns out to be the copyright-safe shape.
- **No merged "best list"** across 360Giving and an AI search. They have
  opposite reliability profiles — evidenced but historical, current but
  unverified — and averaging them hides the difference. 360Giving targets the
  search; it does not sit beside it.

## Explicitly out of MVP
Billing · push/email notifications (superseded in part: the tracker exports to the user's own
calendar, which reminds them without us building a channel) · post-award reporting · human marketplace · predictive matching ·
integrations · public API · white label · learned organisational voice · theory-of-change generation
