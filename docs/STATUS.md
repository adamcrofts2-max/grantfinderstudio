# STATUS

**Last updated:** 2026-09-06

## What exists

### Documentation
- `docs/PRODUCT_ARCHITECTURE.md` — full product and technical analysis (Part 1)
- `docs/MASTER_IMPLEMENTATION_PROMPT.md` — the implementation prompt this build follows (Part 2)

### Phase 0 — tooling ✅
TypeScript strict (`noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`), Vitest with v8
coverage and 90% thresholds, `@/*` path alias. No framework yet — deliberately, so the
domain core stays free of framework coupling.

### Phase 1 — domain core ✅
Pure TypeScript, zero I/O. **103 tests, 100% statement/branch/function/line coverage.**

| Module | What it does |
|---|---|
| `src/domain/types.ts` | Legal forms, jurisdictions, freshness, deadline types, source types; predicates for asset lock, share capital, guarantee |
| `src/domain/eligibility/` | Deterministic rules engine over 10 criterion kinds. `unknown` is first-class and never coerced |
| `src/domain/effort/` | Application effort in hours from observable form features; value-per-hour recommendation |
| `src/domain/provenance/` | Append-only fact lifecycle, supersession, confirmation, claim grounding |

**Design decisions worth remembering**
- Eligibility is a pure function. AI proposes criteria; a human verifies; this engine decides.
  A wrong verdict is the product's worst failure mode, so it is the most-tested code here.
- `evaluateEligibility` returns `unknown` for an empty criteria set. Knowing nothing about a
  funder's rules is not the same as meeting them.
- All CICs carry a statutory asset lock — so `asset_locked_only` is unconditionally a pass on
  the CIC path. This is the case applicants most often misread as "charities only".
- Effort constants live in `EFFORT_CONSTANTS` and value bands in `VALUE_THRESHOLDS`, so they
  can be tuned from real usage rather than being scattered through the code.
- Facts are never mutated. `supersede()` returns both records; callers persist both.
- Only confirmed, non-superseded facts may ground generated prose (`isUsableForGeneration`).

## Not built yet

Phases 2–11 of `docs/MASTER_IMPLEMENTATION_PROMPT.md`: database and RLS, auth, onboarding,
360Giving ingestion, opportunity index, document intelligence, application workspace, critic
and red team, pipeline, export.

## Known constraints in this environment

- **Push is blocked.** The Claude GitHub App has read but not write access to this repo.
  Commits are local until write access is granted at
  https://github.com/apps/claude/installations/select_target
- **Egress is allowlisted.** `api.threesixtygiving.org` and
  `find-government-grants.service.gov.uk` return `connect_rejected` from this container.
  Ingestion connectors must be written against recorded fixtures here and verified live
  elsewhere before any claim is made about coverage.
- **No Postgres, no Docker.** Integration and RLS tests must be gated on `DATABASE_URL` and
  run in an environment that has a database. This is a large part of why the domain core is
  pure — the highest-risk logic stays fully testable regardless.

## Next task

Phase 2: schema, migrations and Row-Level Security policies, with automated cross-tenant
isolation tests. Do not start Phase 3 until those tests pass against a real Postgres.
