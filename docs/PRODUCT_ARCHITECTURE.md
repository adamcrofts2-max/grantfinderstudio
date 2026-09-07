# Grant Finder Studio — Product & Technical Architecture

**Status:** Foundational design, v1.0
**Author:** Lead product/technical architecture pass
**Date:** 2026-09-06

---

## 0. Executive summary — the three decisions that matter

Everything below follows from three calls. If you disagree with these, the rest changes.

**1. Do not compete on database breadth. Compete on decision quality.**
Idox GrantFinder maintains 8,500+ live UK funding opportunities with a paid research team, updated daily. A new entrant cannot match that legally or economically. Attempting it produces a thin, stale database that is worse than the free alternatives and creates legal exposure. The differentiator is not *how many* opportunities you list — it is whether a time-poor CIC can tell, in ninety seconds, which three are worth their next twenty hours.

**2. The free, open, legally clean asset nobody is using well is 360Giving awarded-grants data.**
Over one million grants, £8bn+, 200+ UK funders, open API, no authentication required. It is *backward-looking*, which is why competitors treat it as a research curiosity rather than a product core. But for a CIC choosing where to spend scarce hours, "this funder made 47 grants between £15k and £40k to youth organisations in the South West in the last three years, median £22k" is stronger evidence of fit than any funder's own stated priorities page. **Funder behaviour is more predictive than funder rhetoric.**

**3. Eligibility must be deterministic. Never AI-evaluated.**
This is the single most consequential architectural decision in the product. An AI that hallucinates eligibility costs a volunteer twenty hours, or worse, produces a submitted application that was never eligible. Eligibility is a rules engine over structured, human-verifiable criteria. AI is used only to *propose* structured criteria from unstructured guidance — a human confirms before it is ever used to judge. This is the difference between a product a funding professional would trust and one they would not.

---

## 1. The problem, restated

The brief frames the problem as "CICs can't find funding." That is a symptom. Three distinct problems hide underneath, and they need different solutions:

| Problem | Who has it | Real cause | What actually fixes it |
|---|---|---|---|
| **Discovery** | Everyone | Fragmented sources; no single index | Aggregation — but this is largely a solved, commoditised problem |
| **Triage** | Time-poor CICs | No way to judge effort vs. reward before committing | Deterministic effort modelling + eligibility + funder-behaviour evidence |
| **Articulation** | Inexperienced applicants | Cannot translate what they do into what funders assess | Retrieval-grounded writing over verified organisational facts |

Discovery is the least defensible and the most expensive. **Triage and articulation are where the product wins**, and both depend on the same underlying asset: a structured, provenance-tracked model of the organisation.

The brief's own instinct is right — §14 (Funding Opportunity Value) and §67 (Funding Time Economics) are the strongest ideas in the specification. They are also the most under-specified. This architecture promotes them to the centre.

---

## 2. Market and data research findings

### 2.1 Competitive landscape

| Product | Model | Strength | Weakness for a CIC |
|---|---|---|---|
| **GrantFinder (Idox)** | Paid, enterprise-priced | 8,500+ live opportunities, daily research team | Priced far above a small CIC's reach; a database, not an assistant |
| **My Funding Central (Idox)** | Free under £30k income, banded above | Genuinely free at the bottom | Discovery only; no application help |
| **Funds Online (DSC)** | Paid subscription | Established trust directory | Directory UX; no fit reasoning |
| **Charity Excellence** | Free (registration) | Best free all-rounder; generous | Charity-shaped; CIC eligibility is a persistent edge case |
| **GrantNav (360Giving)** | Free, open | Real awarded-grants data | Awarded grants only; research tool, not a workflow |
| **GOV.UK Find a Grant** | Free, official | Authoritative, official deadlines | Only ~100–120 live central-government grants |
| **US AI writing tools** (Grantable, Instrumentl et al.) | SaaS | Strong drafting UX | US funder model; no UK eligibility logic; no CIC concept |

**The gap:** every UK tool is either a *database* or a *writer*. None connects verified organisational knowledge to deterministic eligibility to funder-behaviour evidence. And none of them models the CIC legal form properly — CICs sit in a persistent blind spot, routinely excluded by funders who fund "registered charities only", or eligible via routes the applicant never discovers.

**CIC-specific eligibility is the wedge.** It is unglamorous, it is real, and it is currently nobody's job.

### 2.2 Market size

37,081 CICs on the register as of the 2024–25 Regulator annual report, up 12% year on year (32,500+ the prior year, itself 20% growth). Fast-growing, chronically underserved, and structurally disadvantaged in a funding market built around charity status.

### 2.3 Data source assessment

| Source | Access | Licence | Covers | Verdict |
|---|---|---|---|---|
| **360Giving API** (`api.threesixtygiving.org/api/v1/`) | Open HTTP/JSON, no auth | Per-publisher open licences (CC-BY, CC-BY-SA, OGL) | ~1M **awarded** grants, 200+ funders | **Core asset.** Build on it |
| **GOV.UK Find a Grant** | Web service | OGL for GOV.UK content | ~100–120 live central gov opportunities | Include; small but authoritative |
| **Companies House API** | Free API key, 600 req/5min | Public data | CIC registration, status, filings | Use for verification/onboarding |
| **CIC Regulator filings** | Public | OGL | CIC34 community interest reports | Useful later |
| **Funder websites** | Varies | Usually all rights reserved | Live opportunities | **Only with permission.** Do not scrape |
| **Charity Commission Register of Charities API** | Free API key + monthly bulk extract | Public data | Funder financials, filing status | **Add.** Most funders are themselves charities |

### 2.3.1 Revision, September 2026 — three needs, two sources

The table above conflated three questions that turn out to have different answers.
Revisited after a second research pass, the position is:

**"Who am I?" — Companies House. Correct and irreplaceable.** Nothing else can
confirm CIC status and the statutory asset lock. No change.

**"Which funders fund work like mine?" — 360Giving, and it is a bigger asset
than this document originally credited.** Over 1 million grants from 330+
funders — family trusts, community foundations, lottery distributors and
government departments — representing more than £300bn, updated daily, with a
free bulk CSV/JSON download alongside the query API. It should power
*discovery by prospect*, not merely decorate an opportunity page that somehow
already exists.

**"What is open right now, and can a CIC apply?" — no source exists.** This is
the finding that matters, and it changes what we build:

- **GOV.UK Find a Grant carries roughly 119–121 grants, central government
  only.** No trusts, no foundations. For a rural CIC doing youth or
  environmental work it is close to irrelevant. Demoted from "include" to a
  later, small win.
- **360Giving is awarded grants by design.** It will never say what is open.
- **There is no central register of trust and foundation calls.** ACF's
  transparency principles are voluntary and unevenly followed; there is no
  standard process; funders publish deadlines on their own websites.
- **The commercial incumbents do this with people.** GrantFinder advertises
  8,500+ live opportunities "verified by expert researchers", daily.

**Consequence 1 — the first commitment is stronger than modesty.** "Do not
compete on database breadth" is not a positioning choice, it is arithmetic:
there is no feed to compete with. Matching the incumbents means hiring
researchers.

**Consequence 2 — a calls list is the wrong primitive anyway.** Much of the
trust sector accepts applications year round or works by invitation. Modelling
the world as "open calls with deadlines" misdescribes the sector.

**Consequence 3 — eligibility is confirmed as the wedge.** Nobody publishes
eligibility criteria machine-readably. Most UK funders restrict applications to
registered charities; many accept CICs; and the sector's own advice is that you
must confirm it for every specific fund you consider. That sentence is the
product. A deterministic per-criterion check with explicit unknowns is the
thing that cannot be obtained elsewhere.

**So the opportunity pipeline is: the applicant brings the fund.** Paste the
funder's own guidance and we turn it into an assessable opportunity — criteria
proposed by AI, verified by a person, then decided by the engine. The same
shape as every other reframe this product has made: copy/paste is the
submission mechanism, the user's calendar is the reminder mechanism, and the
funder's own page is the opportunity database.

**Continuity risk, logged:** 360Giving merged into Funders Together on
1 February 2026. GrantNav and 360Insights are confirmed as continuing and
evolving, so this is a watch item rather than a blocker. Separately, the
Datastore drops a publisher's dataset after 91 days if it becomes invalid or
unavailable — which is exactly what the `freshness` states exist to represent.

**Verification caveat:** this environment's egress allowlist blocks both
`find-government-grants.service.gov.uk` and the 360Giving domains, so the
figures above come from published sources rather than from calling the APIs.
Re-check the counts from an environment with outbound access before repeating
them in anything commercial.

**Critical licensing finding:** 360Giving publishers each choose their own open licence. Some are CC-BY, some CC-BY-**SA**. Share-alike propagates to derived datasets. This is not a footnote — it is a schema requirement.

> **Architectural consequence:** licence metadata is stored *per source dataset*, carried through every derived record, and enforced at display and export time. A CC-BY-SA-derived aggregate cannot be silently folded into proprietary output. The system must be able to answer "which licences touched this screen?" for any screen.

**Environment note:** this build environment's egress allowlist blocks `api.threesixtygiving.org` and `find-government-grants.service.gov.uk`. Connectors are therefore written against recorded fixtures and contract tests, and must be verified live in an environment with outbound access before any production claim is made. See §11.

---

## 3. Ideal customer profile

The brief asks (§6) which customer to focus on. Considering five candidates:

| Segment | Pain | Ability to benefit | Willingness to pay | Verdict |
|---|---|---|---|---|
| Brand-new CIC | Highest | **Low** — no track record, no evidence, often not yet fundable | Very low | Secondary |
| **Established small CIC** (£50k–£500k turnover, 1–5 staff, delivering, applies 5–15×/yr) | High | **High** — has documents, history, evidence to reuse | Real | **PRIMARY ICP** |
| Volunteer-run CIC | High | Medium — time-poor is exactly the pitch | Low | Strong secondary |
| Experienced fundraiser | Medium | High | High | Later (needs pipeline/CRM) |
| Large CIC | Low | Medium | High | Not now |

**Primary ICP: the established small CIC.** The product's core value is *reuse of verified organisational knowledge* — which requires knowledge to exist. This segment has documents, delivered projects, and outcomes, and is currently losing applications for articulation reasons rather than merit reasons. They feel every wasted twenty hours.

This is a deliberate rejection of the intuitive choice. The new CIC has the loudest pain, but the product cannot honestly help them win — they frequently lack the track record funders require. Serving them well means a narrower "funding readiness" path that tells them what to build before applying, not a drafting tool that helps them write a losing application faster.

---

## 4. Challenging the brief

The brief explicitly invites challenge (§3, §63). Here is where I depart from it.

### 4.1 REMOVE from MVP

| Feature | Brief § | Why remove |
|---|---|---|
| **Composite "Funding Fit Score"** | §12 | A single number cannot be validated — there is no outcome data at launch. It invites exactly the misplaced trust §42 warns against. **Replaced** by three separate, honest signals (§5.2 below) |
| **Billing** | §56 | Zero users. 3–4 weeks that teaches nothing. Ship free, learn, then price |
| **Proactive assistant / notifications** | §16 | Requires a live opportunity feed that does not yet exist. Building notifications over a thin feed manufactures noise |
| **Post-award reporting** | §38 | Entire second product. Model the data so it is possible; build none of it |
| **Human assistance marketplace** | §39 | Correctly flagged as non-MVP by the brief itself |
| **Rejection learning** | §37 | *Record* outcomes from day one. "Learning" from n<200 is statistically meaningless and invites fabricated causality |
| **Learned organisational voice** | §26 | Reduce to a style selector. Voice-learning from documents is high effort, low marginal value, and risks importing errors |
| **Full theory-of-change engine** | §33 | Reduce to a structured activity→output→outcome table. Logic-model generation produces the meaningless impact language §33 itself warns against |
| **13 specialised AI agents** | §50 | Unmaintainable at MVP. **Collapse to 4** (§7) |

### 4.2 ADD — missing from the brief

| Addition | Why it matters |
|---|---|
| **CIC-specific eligibility taxonomy** | The brief treats CIC status as one field. It is the *entire wedge*. Funders exclude CICs in at least six distinct patterns (charity-only; asset-locked-body-only; limited-by-guarantee-only; no-share-capital-only; CIC-permitted-with-conditions; silent-and-must-be-asked). Model these explicitly |
| **"Ask the funder" generator** | When eligibility is genuinely unknown, the honest, useful output is a short email to the funder. Turning an unknown into a *next action* is more valuable than a confidence score |
| **Effort model as a first-class deterministic feature** | Brief §14/§67 gesture at it. It should be computed from observable facts (question count, total word budget, required attachments, accounts/policy requirements, match-funding) — no ML, fully explainable |
| **Licence propagation as schema** | Not mentioned. Required by CC-BY-SA reality (§2.3) |
| **Postgres Row-Level Security** | §46 demands tenant isolation. Application-level filtering *fails open*; RLS *fails closed*. Non-negotiable for multi-tenant |
| **Funding readiness assessment** | For CICs not yet fundable, saying so early is the most valuable and most honest output the product can give |
| **Answer provenance at sentence level** | §41 applies provenance to facts. Extend to generated prose: every claim in a draft traces to a verified fact or is flagged unsupported |

### 4.3 CHANGE

| Brief says | Change to | Reason |
|---|---|---|
| Fit Score (§12) | **Eligibility verdict + funder-behaviour evidence + explicit unknowns** | Honest, auditable, validatable |
| Onboarding builds full ontology (§7, §8) | **Six entities in MVP**: Organisation, Project, Fact, Evidence, Document, Answer | The full graph is a six-month build |
| Red Team as separate system (§30) | **A mode of the Critic** | Same retrieval, same context, different instruction and rubric |
| "Should we apply?" 4-tier (§13) | Keep, but drive it from **effort vs. amount vs. eligibility**, never inferred success probability | Defensible |

---

## 5. The user experience

### 5.1 First run — the ninety-second promise

The brief is right (§4) to reject the onboarding questionnaire. The opening screen asks one question:

> **What are you trying to fund?**
> *e.g. "We're a CIC in Somerset helping disadvantaged young people learn practical environmental skills. We need about £30,000 for a 12-month programme."*

From that single paragraph the system extracts a **draft** project and organisation sketch — every field marked *unconfirmed*, with the source span highlighted. It then asks for the **company number** (one field), verifies against Companies House, and confirms legal form, incorporation date and registered office automatically.

The user has now spent under ninety seconds and the system knows: legal form, age, location, cause area, beneficiary group, amount sought, duration. That is enough to run eligibility against every funder in the index.

**Nothing is asked that can be derived, and nothing derived is treated as true until confirmed.**

### 5.2 The result screen — three honest signals, not one score

Replacing the composite score:

```
┌─────────────────────────────────────────────────────┐
│ ELIGIBILITY          ✓ Eligible                     │
│   Legal form         ✓ CIC explicitly permitted     │
│   Geography          ✓ Somerset within South West   │
│   Amount             ✓ £30k within £10k–£50k range  │
│   Org age            ⚠ Needs 2 years — you have 18m │
│   Match funding      ? Not stated — ask the funder  │
├─────────────────────────────────────────────────────┤
│ FUNDER BEHAVIOUR     Based on 47 awarded grants     │
│   Typical award      £15,000 – £40,000 (median £22k)│
│   Your ask of £30k   Within normal range            │
│   Youth orgs funded  12 of last 47                  │
│   Source: 360Giving · CC-BY · retrieved 2026-09-01  │
├─────────────────────────────────────────────────────┤
│ EFFORT               ~9 hours  (Moderate)           │
│   8 questions · 2,400 words · 3 attachments         │
│   Requires: latest accounts, safeguarding policy    │
├─────────────────────────────────────────────────────┤
│ → £30,000 for ~9 hours, one open question           │
│   RECOMMENDATION: Strong — resolve the age question │
│   first by asking the funder.  [Draft that email]   │
└─────────────────────────────────────────────────────┘
```

Every number here is either deterministic or sourced. Nothing is inferred and presented as fact. The one unknown is surfaced as an *action*, not a caveat.

### 5.3 Three-user friction test (brief §64)

**User A — first-time founder, knows nothing.** Types one paragraph, gives company number. Sees "you need 2 years' trading for most of these — here are 6 funders that fund organisations under 2 years old." *Honest triage beats a false start.* Terminology is explained inline on first use only.

**User B — experienced fundraiser, multiple applications.** Wants the pipeline and reuse. Value is the answer library: previously verified organisation descriptions, evidence with sources, outcome sets — reusable with provenance shown. Skips all explanation.

**User C — volunteer, two hours a month.** Only ever needs the effort column and the recommendation line. Everything else is progressive disclosure. Must be able to close the laptop mid-draft and resume with zero loss.

**Friction points removed:** no signup before value (explore anonymously, account only to save); no document upload required to start; no separate "create project" step; no mandatory profile completion; no modal tours.

---

## 6. Technical architecture

Deliberately boring. Every technology chosen is one a competent contractor can maintain.

```
┌───────────────────────────────────────────────────┐
│ Next.js 15 (App Router) · React · TypeScript      │
│ Tailwind + shadcn/ui · WCAG 2.2 AA                │
└───────────────────┬───────────────────────────────┘
                    │ Server Actions / Route Handlers
┌───────────────────▼───────────────────────────────┐
│ APPLICATION LAYER                                 │
│  auth · RBAC · tenant context · rate limit · audit│
└───────────────────┬───────────────────────────────┘
┌───────────────────▼───────────────────────────────┐
│ DOMAIN CORE  (pure TypeScript, zero I/O)          │
│  eligibility engine · effort model · provenance   │
│  fit evidence · budget validation · readiness     │
│  ── fully unit-testable, no database required ──  │
└──────┬──────────────────────┬─────────────────────┘
       │                      │
┌──────▼──────────┐  ┌────────▼──────────────────────┐
│ PERSISTENCE     │  │ AI LAYER                      │
│ Postgres + RLS  │  │ provider abstraction          │
│ pgvector        │  │ schema-validated I/O          │
│ Drizzle ORM     │  │ prompt versioning · eval      │
└─────────────────┘  └───────────────────────────────┘
┌───────────────────────────────────────────────────┐
│ INGESTION  connectors → normalise → dedupe →      │
│            licence-tag → verify → index           │
└───────────────────────────────────────────────────┘
```

**Stack rationale**

| Choice | Why | Rejected alternative |
|---|---|---|
| Next.js App Router | One deployable, server components suit read-heavy pages, mature | Separate SPA + API — needless split at this size |
| Postgres + pgvector | Relational integrity for a genuinely relational domain; vectors without a second datastore | Dedicated vector DB — unjustified complexity |
| **Row-Level Security** | Tenant isolation that fails closed | App-level filtering — one missing clause leaks a tenant |
| Drizzle | Typed SQL, transparent migrations, no hidden query behaviour | Prisma — heavier, more magic |
| **Pure domain core** | Eligibility/effort logic testable without infrastructure; the highest-risk logic gets the fastest tests | Logic in route handlers — untestable |
| Background jobs via queue | Ingestion and document parsing must not block requests | Cron in-process — fragile |

**The hexagonal split is the important part.** Eligibility, effort and provenance are pure functions over plain data. They need no database, no network, no AI. They can be tested exhaustively in milliseconds. Given that a wrong eligibility verdict is the product's worst failure mode, the code that decides it must be the most heavily tested code in the system — which requires it to be the easiest to test.

---

## 7. AI architecture

**Four agents, not thirteen.** Each has a JSON schema, a versioned prompt, validation, retries and a recorded evaluation set.

| Agent | Input | Output | Never does |
|---|---|---|---|
| **Extractor** | Documents, user prose | Candidate facts + source spans + confidence | Assert truth. Everything lands *unconfirmed* |
| **Analyst** | Funder guidance, application forms | Candidate structured criteria, questions, word limits | **Decide eligibility.** It proposes; the rules engine decides |
| **Writer** | Question + retrieved verified facts + criteria | Draft answer with per-claim fact references | Invent a fact not in retrieval. Unsupported sentences are flagged, not silently written |
| **Critic** | Draft + criteria + facts | Findings by severity; `redTeam` mode inverts the rubric to "why would I reject this?" | Score probability of success |

**Hard rules**

1. **AI never decides eligibility.** It proposes structured criteria; a deterministic engine evaluates them; a human confirms the criteria before first use.
2. **Retrieval-grounded generation only.** The Writer receives verified facts. A claim with no fact behind it is rendered as `[UNSUPPORTED: needs evidence]`, visible in the UI. Never silently plausible.
3. **Untrusted content is data, never instruction.** Document and web content enters inside delimited data blocks with a standing instruction that content within is inert. Extracted output is schema-validated; anything resembling an instruction is discarded and logged.
4. **Structured output or fail.** Schema violation → retry → fail visibly. Never a partially-parsed guess.
5. **Provider abstraction.** No provider SDK outside `lib/ai/providers/`. Customer data is never used for external model training; retention and subprocessors are documented.
6. **No API key = clearly-labelled unavailability.** Never a fake response. Per brief §71 (no fake AI).

**Evaluation** (brief §51): a golden set covering hallucinated facts, wrong eligibility, fabricated citations, invented deadlines, missed word limits, generic prose, budget inconsistency. Prompt changes run the set. Regressions block.

---

## 8. Data model

Fifteen tables in MVP, not fifty. Every tenant-scoped table carries `organisation_id` and an RLS policy.

**Tenancy & identity:** `users`, `organisations`, `memberships` (role: owner/admin/editor/viewer)

**Organisation knowledge:**
- `organisation_profiles` — legal form, company number, incorporation date, jurisdiction, registered office
- `projects` — name, description, beneficiaries, geography, dates, amount sought
- `facts` — **the provenance core**: `claim`, `value`, `source_type` (user/document/companies_house/ai_extraction), `source_ref`, `source_span`, `retrieved_at`, `confidence`, `confirmed_by`, `confirmed_at`, `superseded_by`
- `evidence` — claim, source URL, publisher, publication date, geography, population, review date
- `documents` + `document_chunks` (pgvector embedding, page/span refs)

**Funding:**
- `funders` — identity, plus `stated` vs `derived` attribute separation
- `funder_awards` — from 360Giving; `source_dataset_id` → licence
- `opportunities` — with `freshness` enum (current / recently_verified / needs_verification / stale / closed / unknown) and `deadline_type` enum (confirmed / rolling / expected / estimated / unknown)
- `eligibility_criteria` — **structured, machine-evaluable**, `verified_by`, `verified_at`
- `source_datasets` — **licence, attribution text, terms URL, permitted uses, retrieved_at**

**Applications:**
- `applications` (pipeline status), `application_questions` (word limits, criteria), `answers` + `answer_versions`, `answer_fact_refs` (sentence→fact provenance), `reviews` (mode: standard/red_team), `budgets` + `budget_lines`, `outcomes`

**Operational:** `audit_logs`, `ai_generations` (prompt version, model, tokens, cost, latency)

**Key constraints:** facts are append-only and superseded, never updated in place — the brief's §9 requirement that corrections do not erase history. Every AI-derived row carries the generation id that produced it.

---

## 9. UK legal & compliance as architecture

Per brief §40 — enforced in code, not in a disclaimer.

| Requirement | Architectural mechanism |
|---|---|
| **UK GDPR / DPA 2018** | Lawful basis recorded per processing purpose; retention policy per table; export and erasure implemented as first-class operations, not manual SQL |
| **Data minimisation** | Special-category data actively discouraged: upload flow warns and suggests anonymised/aggregate alternatives. No identifiable-beneficiary record type exists in the schema — this is deliberate |
| **Children / vulnerable people** | No beneficiary-individual table. Case studies stored as organisation-authored text with an explicit "consent obtained" attestation, never auto-generated |
| **Jurisdiction** | England / Wales / Scotland / NI / UK-wide is a first-class enum on opportunities, criteria and evidence — never a free-text field |
| **Licence compliance** | `source_datasets.licence` propagates to every derived row; attribution rendered wherever data is displayed; export blocked or annotated where share-alike applies |
| **Deadline honesty** | `deadline_type` enum makes "estimated" structurally incapable of rendering as "confirmed" |
| **No professional advice** | Tax/legal/subsidy-control topics route to a "identify → explain → authoritative source → verify with a professional" component. Never a definitive answer |
| **Funder precedence** | Every opportunity view carries retrieval date and "verify current requirements with the funder before submission" |
| **Copyright** | Funder guidance is stored as extracted structured criteria plus a link — never wholesale reproduction. No "successful application" corpus |
| **AI transparency** | Providers, retention, training use, subprocessors documented; no customer data to external training |

**Security** (§44): RLS-enforced tenant isolation with explicit cross-tenant tests; RBAC; signed URLs with short TTL; file type/size validation and content sniffing; SSRF allowlist on any outbound fetch; rate limiting; audit logging; CSRF via framework defaults; parameterised queries throughout.

**Accessibility** (§45): WCAG 2.2 AA as a build gate, not a review item — automated axe checks in CI, keyboard-navigable throughout, semantic HTML, visible focus, form errors tied to inputs.

---

## 10. MVP definition

**In:**
1. Sign up; create organisation; verify via Companies House
2. Describe funding need in natural language → extracted draft project
3. Progressive profile building; facts with provenance; user confirmation
4. Document upload → parse → extract candidate facts → confirm
5. Funder intelligence from 360Giving awarded data
6. Opportunity index from permitted sources with freshness states
7. **Deterministic eligibility verdict** with per-criterion reasoning and explicit unknowns
8. **Effort estimate** and amount-vs-effort recommendation
9. "Ask the funder" email generator for unknowns
10. Application workspace: questions, retrieval-grounded drafting, per-claim provenance
11. Critic review + red-team mode
12. Simple budget with funder-restriction checks
13. Outputs/outcomes table
14. Pipeline with deadline tracking
15. Export to DOCX/PDF

**Out:** billing, notifications, post-award reporting, human marketplace, collaboration beyond basic roles, predictive matching, integrations, API, white label.

**Acceptance is behavioural, not page-count** (brief §72): a real CIC completes the journey from one paragraph to an exported, submission-ready application, and every factual claim in it traces to a confirmed source.

---

## 11. Failure modes and mitigations

| Failure | Severity | Mitigation |
|---|---|---|
| **Wrong eligibility verdict** | Critical | Deterministic engine; human-verified criteria; unknowns never guessed; exhaustive unit tests |
| **Fabricated evidence/statistic** | Critical | Writer cannot emit unretrieved claims; unsupported sentences flagged in UI; eval set |
| **Cross-tenant leak** | Critical | Postgres RLS; automated cross-tenant tests in CI |
| **Stale opportunity shown as live** | High | Freshness enum surfaced in every view; stale results visually distinct and down-ranked |
| **Estimated deadline read as confirmed** | High | `deadline_type` enum; distinct rendering; never normalised away |
| **Prompt injection via uploaded PDF** | High | Content as delimited data; schema-validated output; injection eval corpus |
| **Licence breach (share-alike)** | High | Per-dataset licence propagation; export gating |
| **Thin opportunity coverage vs Idox** | Commercial | Do not compete on breadth; lead with funder intelligence + triage |
| **Connectors unverified against live APIs** | Build | Egress-blocked here; contract tests + fixtures, live verification required before launch claims |

---

## 12. Commercial model (recommendation, not MVP work)

Ship free. Price after ~50 organisations have completed the full journey and you know which step they would pay to keep.

Working hypothesis, to be tested rather than built now:
- **Free** — profile, funder intelligence, eligibility checks, 1 application
- **Standard (~£29/mo)** — unlimited applications, evidence library, review + red team, exports
- **Team (~£79/mo)** — multiple users, pipeline, deadlines
- **Assisted** — human review, priced per engagement

Do not cripple the free tier to force upgrades (brief §56). The free tier must be genuinely the best free CIC funding tool in the UK — that is the acquisition strategy.

---

## 13. Moat

Honest assessment. AI is not a moat; every competitor has the same models.

**Real, compounding:**
1. **CIC eligibility knowledge base** — structured, human-verified criteria on how each funder treats the CIC legal form. Expensive to build, boring, permanent, and currently nobody's job.
2. **Verified organisational knowledge** — switching cost grows with every confirmed fact and reused answer.
3. **Funder behaviour intelligence** from open awarded-grants data, structured for matching rather than research.

**Not a moat:** the opportunity database (Idox wins), the AI models, the UI.

---

## Sources

- [360Giving — GrantNav](https://grantnav.threesixtygiving.org/) · [API documentation](https://www.threesixtygiving.org/360giving-api-documentation/) · [Using the API](https://www.360giving.org/api-docs/use/) · [Datastore](https://www.360giving.org/explore/technical/datastore/) · [Open licence guidance](https://www.360giving.org/publish/guidance/publish/open-license/)
- [GOV.UK Find a Grant](https://www.find-government-grants.service.gov.uk/) · [Terms and conditions](https://www.find-government-grants.service.gov.uk/info/terms-and-conditions) · [Reuse GOV.UK content](https://gov.uk/help/reuse-govuk-content)
- [Companies House API — API Catalogue](https://www.api.gov.uk/ch/companies-house/)
- [Regulator of Community Interest Companies Annual Report 2024–25](https://assets.publishing.service.gov.uk/media/68809f4f28f29c99778a7504/cic-25-01-community-interest-companies-annual-report-2024-2025.pdf)
- [GrantFinder (Idox)](https://grantfinder.co.uk/) · [Charity Excellence Funding Finder](https://www.charityexcellence.co.uk/free-grant-funding-finder-directory/) · [Grants Online](https://www.grantsonline.org.uk/) · [GrantMatch — grants for CICs](https://www.grantmatch.co.uk/grants/org-type/cic)
- September 2026 research pass: [360Giving — what data is available](https://www.360giving.org/explore/before-you-start/what-data/) · [GrantNav data and bulk download](https://www.360giving.org/explore/technical/grantnav-data/) · [360Giving uniting with Funders Together](https://www.360giving.org/2026/01/13/360giving-uniting-with-funders-together/) · [Charity Commission API documentation](https://register-of-charities.charitycommission.gov.uk/en/documentation-on-the-api) · [How trusts and foundations fit into the system (Plinth)](https://www.plinth.org.uk/sector-essentials/how-trusts-and-foundations-fit-in) · [Finding funding for charities and voluntary organisations (House of Commons Library)](https://commonslibrary.parliament.uk/research-briefings/cbp-10663/)
