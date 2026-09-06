# ROADMAP

Ordered by phase. Tick only what genuinely shipped — built, tested, verified.

## Phase 0 — Tooling
- [x] TypeScript strict configuration
- [x] Vitest with coverage thresholds
- [x] Path alias `@/*`
- [ ] Lint (oxlint or eslint)
- [ ] CI workflow running build, lint, test, coverage

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
- [ ] Budget validation against funder restrictions
- [ ] Application readiness scoring

## Phase 2 — Persistence
- [ ] Drizzle schema for the 15 MVP tables
- [ ] Migrations
- [ ] Row-Level Security policies on every tenant-scoped table
- [ ] Automated cross-tenant isolation tests
- [ ] `source_datasets` licence propagation

## Phase 3 — Auth and tenancy
- [ ] Authentication
- [ ] Organisations and memberships
- [ ] RBAC (owner/admin/editor/viewer)
- [ ] Audit logging

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
