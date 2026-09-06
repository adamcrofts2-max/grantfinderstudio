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

## Phase 2 — Persistence
- [x] SQL schema covering the MVP tables, with enums and check constraints
- [x] Migrations (`src/db/migrations`)
- [x] Row-Level Security on every tenant-scoped table, with `WITH CHECK`
- [x] Automated cross-tenant isolation tests against real Postgres (PGlite/WASM)
- [x] `source_datasets` table carrying licence and attribution
- [ ] pgvector extension and `document_chunks.embedding`
- [ ] Drizzle typed query layer (deferred to Phase 3, where the queries are)
- [ ] Licence propagation enforced at query and export time

## Phase 3 — Auth and tenancy
- [x] RBAC (owner/admin/editor/viewer) with lock-out invariants
- [x] Per-request tenant context via transaction-local `set_config`
- [x] Tests proving the context cannot outlive a request
- [ ] Authentication (sessions, sign-in)
- [ ] Organisation and membership management endpoints
- [ ] Audit logging on privileged actions

## Phase 4 — Onboarding
- [ ] Natural-language intake ("What are you trying to fund?")
- [ ] Companies House verification
- [ ] Fact confirmation UI with source spans

## Phase 5 — Funder intelligence
- [ ] 360Giving connector (contract tests + fixtures)
- [ ] Live verification against the real API
- [ ] Funder behaviour summaries with attribution
- [ ] Licence rendering and export gating

## Phase 6 — Discovery
- [ ] Opportunity index with freshness states
- [ ] Eligibility results UI (three signals, no composite score)
- [ ] Effort display
- [ ] "Ask the funder" email generator

## Phase 7 — Document intelligence
- [ ] Upload, parse, chunk, embed
- [ ] Candidate fact extraction with source spans
- [ ] Prompt-injection test corpus

## Phase 8 — Application workspace
- [ ] Question intelligence ("what this question is really asking")
- [ ] Retrieval-grounded drafting
- [ ] Per-claim provenance UI, unsupported-claim flagging

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
