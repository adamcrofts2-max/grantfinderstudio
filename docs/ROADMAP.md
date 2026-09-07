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
- [ ] Deploy and verify Companies House and 360Giving against their real APIs

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
- [ ] Manual entry, recorded as self-declared rather than verified
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

## Phase 7 — Document intelligence
- [x] AI provider abstraction; no vendor SDK outside `src/ai/providers`
- [x] Untrusted-content fencing with a per-call random marker
- [x] Schema-validated agent runner with one retry, then visible failure
- [x] Extractor agent producing candidate facts that are never confirmed
- [ ] Upload, parse and chunk documents
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
- [ ] Creating an application from any opportunity

## Phase 9 — Review
- [ ] Critic agent
- [ ] Red-team mode
- [ ] Readiness breakdown
- [ ] Budget engine
- [ ] Outcomes table

## Phase 10 — Pipeline and export
- [ ] Pipeline states
- [ ] Deadline tracking with honest deadline types
- [ ] DOCX/PDF export

## Phase 11 — Hardening
- [ ] WCAG 2.2 AA audit with automated axe in CI
- [ ] Security review
- [ ] AI evaluation suite
- [ ] Performance

## Explicitly out of MVP
Billing · notifications · post-award reporting · human marketplace · predictive matching ·
integrations · public API · white label · learned organisational voice · theory-of-change generation
