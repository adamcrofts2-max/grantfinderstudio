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
      (the build environment can reach neither, nor Neon nor Vercel — this is
      the step that unblocks live verification of both)
- [x] Migrations serialised across cold-starting instances by an advisory lock
- [x] Migration SQL inlined so it survives serverless bundling (the first real
      deploy failed on ENOENT; no test could have caught it, since tests run
      with a real filesystem)
- [x] `/api/health` reports the driver's own error and the fix for it
- [x] `/api/health` asserts Row-Level Security is actually in force, because a
      managed host's owner role carries BYPASSRLS and a policy that has stopped
      applying looks exactly like one that works
- [ ] Investigate an intermittent PGlite timeout: one test failed once across
      three full runs and did not reproduce. Load-related, not yet pinned
- [x] Deployment protection no longer the only thing standing in for auth

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
- [x] Authentication: sign-up, sign-in, sign-out, database-backed sessions
- [x] Every screen reads its organisation from the session, never a constant
- [x] Rate limiting on sign-in and sign-up, by address and by origin
- [ ] Confirm the platform overwrites `x-forwarded-for` (Vercel does; the
      per-origin limit is only worth anything where something upstream does)
- [ ] Password reset (needs a mailer; there is none yet)
- [ ] Organisation switcher for someone in more than one
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
- [x] Ingest real 360Giving data into funder_awards (was: connector exists;
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

## Phase 12 — Visual pass
Brief: `docs/DESIGN_BRIEF.md`, written after a screen-by-screen audit. The
product is honest and visually inert: 478 lines of CSS with no transitions, no
SVG and no charts across eleven screens, while every quantity it knows is
rendered as a sentence.

- [x] Motion scale, with `prefers-reduced-motion` throughout
- [x] Funder award distribution chart (highest value — build first)
- [x] Tracker timelines: today → latest start → deadline
- [ ] Effort composition bar
- [ ] Application progress segmentation
- [x] The guided shell is a strip at every width, not only on a phone. A
      15rem column holding three short lines and four hundred pixels of nothing
      sat beside every screen in the product
- [x] An application with no questions leads with pasting them, instead of a
      readiness score and a collapsed row
- [ ] Stat tiles on the three summary screens
- [x] Validated series palette in tokens, light and dark
- [ ] Icon set replacing the single-character glyphs
- [ ] Button hierarchy by consequence
- [ ] Real drop zones on the two upload screens
- [x] Guided setup on the home page, derived from real state rather than flags
- [x] One step at a time — the guide shows the next thing to do, the rest
      folded behind "See all 5 steps"
- [x] Fold the nine-item navigation away until setup is finished, so the
      first screen after signing up is one instruction, not a menu
- [x] Fold it on the FIRST screen too — an account with no organisation yet was
      the one case still shown the whole menu
- [x] Onboarding knows what is already answered: the project form opens where
      the guide's button lands, and the page leads with the step you are on
- [x] Lead with the form that works when Companies House lookup is not
      configured, instead of a search that can only fail
- [x] Count only funds THIS organisation added — shared reference rows were
      ticking off "add a fund" for people who had never added one
- [x] The facts step says where facts come from when nothing is waiting to be
      checked, instead of "confirm the rest" against an empty page
- [x] Disable "Read this fund" when there is no key, rather than spending a
      paste and a wait to say so
- [x] Store the legal form in words — a fact read `cic_limited_by_guarantee`
- [x] Fix the development database's tenant isolation: an operator call left
      the single shared connection un-roled, so any tenant query overlapping it
      ran as the owner and saw every other tenant's rows
- [x] Landing page: a stranger at the root was sent to Sign in and never told
      what the product is
- [x] `/organisation` is 18 buttons in one column on a phone — the step the
      guide sends people to is its heaviest screen. Each fact is a row rather
      than a card now, with one primary button and a quiet "Correct it":
      3,845px to 2,614px at 390px wide, measured on the demo organisation
- [x] Let somebody add a fact by hand, so five confirmed facts is reachable
      without a document reader
- [x] Let somebody add a fund by hand — funder, title, deadline, size — so the
      product is finishable with no Anthropic key at all
- [x] Remove every key-shaped blocker from the setup guide: both steps that
      carried one now have a route that works without a key
- [ ] A hand-entered fund carries no eligibility criteria. Let somebody add
      one or two by hand too, so a typed fund can be checked rather than only
      tracked

## Phase 14 — Funder discovery from awarded grants
The half of the product the landing page now promises. 360Giving publishes what
UK funders have GIVEN, under CC BY 4.0 — which answers "who has actually written
this cheque before", where no source answers "what is open".

- [x] Persist ingested funders and awards. The connector, normaliser,
      behaviour summary, prospect matcher and `/funders` screen were all
      finished; nothing wrote a row, so every one of them ran against an empty
      table
- [x] A real HTTP client: 2 req/sec, timeout, size cap, and a loud failure on
      a non-200 or non-JSON body — an empty page would look like a publisher
      with no grants and delete every award we hold
- [x] Per-funder enrichment first, not the whole corpus, triggered from the
      operator console
- [x] Re-ingest replaces rather than upserts, so a withdrawn grant actually
      goes; scoped to one funder so it cannot touch another's history
- [x] A dry run that fetches one page and writes nothing, so a first ingest
      can separate a wrong id from an unreachable API from a bug
- [x] `/api/health` reports migration state — applied, expected, and pending
      by name
- [ ] Verify against the live API (egress-blocked here; must be run from the
      deployment or a workstation). The dry run is the way in
- [ ] Resolve licence and publisher automatically from 360Giving's own
      registry metadata rather than asking the operator to copy it
- [ ] Quartiles need the grants themselves — the org aggregate gives mean, min,
      max and total but no median, so the distribution chart cannot be fed from
      it. This is what makes ingestion a batch job rather than a lookup
- [x] Give a matched funder somewhere to go. The prospect card ended at the
      evidence with no control at all — `funders.website` was stored from the
      first ingest and rendered nowhere — so the product did the hard part and
      let go exactly where a person needs it
- [x] Join the two halves: `/opportunities/add?funder=<id>` carries the funder
      you picked, pre-fills their name and page, and attaches the fund to that
      exact funder rather than to a second one made from however you typed it
- [x] Fix duplicate `id` attributes on the add-a-fund page — the paste route
      and the typed form both used `sourceUrl`, so the second label pointed at
      the first input. axe 4 retired the duplicate-id rule, so nothing caught it
- [x] Fix adding a fund by hand, which could not work in a real build: a
      `'use server'` module imported a plain array from a `'use client'`
      module, so the bundler handed it a client-reference proxy and the action
      threw "fields is not iterable" before validating anything
- [ ] "Check if they're open" — fetch the funder's own page on demand for the
      person who asked, extract whether anything is open and by when, keep the
      extraction private to that tenant. One page because a human asked, never
      a crawl
- [ ] "Organisations like mine": find recipients in the award data whose
      profile resembles the applicant's, then rank who funded THEM — rather
      than matching only on the applicant's own profile
- [ ] Match funders to an organisation on size, area and beneficiary group,
      each match citing the grants it came from
- [ ] Never present awarded-grant data as an open call. A funder who gave in
      2023 may be closed now, and the freshness vocabulary already has words
      for that
- [ ] Attribution and licence on every screen that shows it (CC BY 4.0)

### AI search for open calls — still undecided
Not on the landing page, and not to be put there until this is settled. The
research already rules out a crawled index (sui generis database right, funder
terms, s29A being non-commercial only). What is left is a licensed index or a
page fetched on demand for the user who asked, extracted to facts and a link
rather than a copy. An AI web search is closer to the second than the first,
but "current but unverified" is a different reliability profile from 360Giving's
"evidenced but historical", and the two must not be averaged into one list.

## Phase 13 — The operator console
Everything the person running the service needs, and nothing that belongs to a
customer. Structural, not disciplined: `app_operator` holds no grant on any
tenant table, so a console page reaching for customer data is refused by
Postgres.

- [x] `admin_accounts` and `admin_sessions`, owner-scope, revoked from PUBLIC
- [x] `app_operator` role with platform-table SELECT and no tenant grants
- [x] `src/db/operator-scope.test.ts` — every tenant and credential table
      asserted refused, table by table
- [x] Close the always-too-wide `GRANT SELECT ON users TO app_user`
- [x] One-time claim guarded by `ADMIN_CLAIM_SECRET`, closed by the INSERT
      rather than a prior count, with no sign-up route at all
- [x] Separate cookie (`/admin`, SameSite=Strict) and an 8-hour session
- [x] Dedicated sign-in throttle axis, tighter than a customer's
- [x] Overview: isolation self-check, deployment readiness, use, limiter
- [x] Shared catalogue: add and remove funds by hand, no key needed
- [x] Accounts: address and sign-up date, with no route to their work
- [x] Middleware so the console never wears the customer's shell
- [x] Move service connections into the console. `/settings` was in the
      customer navigation with NO guard — an unauthenticated GET returned 200
      with the platform's key status in it, and the actions behind it could
      overwrite or delete those keys
- [x] `app_settings` for non-secret operational config, with database →
      environment → default precedence and the source shown
- [x] 360Giving base URL and page cap configurable without a redeploy
- [x] Disable an admin from inside the console (the column existed since 0009
      and nothing set it). Stand down and bring back, sessions deleted rather
      than left to expire, and neither the last enabled admin nor yourself
- [x] A second admin — the claim only ever creates the first. Added from the
      console with a password handed over directly; no invitation email,
      because an emailed console password is one sitting in an inbox
- [x] Change the console password from inside the console — the current one is
      required, and every other session for the account is ended
- [x] Let an operator see the product as a customer does, without being able to
      see a customer. `/admin/sandbox` opens an ordinary customer session over
      an organisation derived from the admin id — no parameter anywhere names
      an organisation, so there is nothing to aim at somebody else
- [x] Close a one-directional check: `MIGRATIONS` is hand-written while the SQL
      map is generated, so a migration could sit in the folder and never run
- [x] Fix the company search being hidden on every real deployment. The page
      gated it on `COMPANIES_HOUSE_BASE_URL` — an optional test-endpoint
      override with a real default that nobody sets — rather than on a stored
      key. The console's overview tile was wrong the same way
- [x] Fix the Companies House verification. It probed one hard-coded company
      number and read every non-OK status as a bad key — but a 404 means
      AUTHENTICATED and not found, so a working key was recorded as failing and
      the search stayed hidden. Now probes search, and only 401 means the key
      is wrong
- [x] "Test the stored key again" — a verdict outlives the code that reached
      it, so deploying the fix changed nothing until the check could be re-run
      without re-pasting the key
- [x] Fix onboarding not advancing after a Companies House confirmation.
      `confirmCompanyAction` saved everything and invalidated nothing, so the
      screen kept rendering the search box and the project step never arrived.
      The invalidation now lives in `commitOrganisation`, which every write
      path must call anyway
- [x] Walk the lookup path end to end in a browser against a stub served over
      a real socket, using the `COMPANIES_HOUSE_BASE_URL` override. It was the
      only route through onboarding that had never run anywhere
- [x] Report a stored-but-failing key as such on the console overview, instead
      of "No key" — which sent an operator to add a key they already had
- [x] A recovery path for a forgotten console password: any admin can set
      another's, and the roster says plainly that one admin means no way back
- [ ] A populated sandbox for demos, and the decision it needs: fictional
      funders are SHARED reference data, so seeding them puts them in front of
      real customers. Tenant-scoped and org-private content (facts, project,
      pasted funds, an application) can be seeded safely; the funders side
      wants a real 360Giving ingest instead
- [ ] Customer-granted support access — time-boxed, single-organisation,
      audit-logged, visible to the customer while live. NOT an admin-initiated
      view: build it the day a real customer is stuck
- [ ] An audit trail of what an operator changed in the shared catalogue
- [ ] First-run moment on onboarding
- [ ] **Nothing to find.** A real deployment has no funders, no awards and no
      opportunities — those are seeded only by the demo module. Every chart is
      empty by construction until either 360Giving ingestion lands or funds are
      added by hand, and adding by hand needs an Anthropic key

### Visual identity — chosen 2026-09-08
Direction settled against three drawn options (tracker + landing hero, each as
today / line characters / annotation): **characters at the front door,
annotation inside the working screens.**

- [x] Display typeface on headings (Bricolage Grotesque, self-hosted)
- [x] Annotation marks — highlighter, ink circle, margin note — both schemes
- [x] Line-character figure and empty states on tracker, applications, funders
- [ ] Replace the placeholder figure with real illustration
- [ ] More than one figure — one drawing across three empty states will wear thin
- [x] Landing page, built for real rather than mocked
- [x] Re-position it: the first version led with "this is not a search engine",
      which was true and badly under-sold. Finding funders IS half the product
      — from awarded grants, which funders DO publish. Three beats now: find,
      weigh, write
- [x] Show the product on it. The real DistributionBar and RecommendationPill
      are imported and rendered, so the page cannot claim a behaviour the
      product does not have; every invented figure is captioned as invented
- [x] Fix white-on-accent: every primary button measured 2.13:1 in dark mode
- [x] Darken `--ink-faint`; at 4.43:1 it was a hair under AA and it carries
      every hint, eyebrow and caption in the product
- [ ] Pricing. Deliberately absent from the landing page until it is decided —
      an invented figure is a promise made to somebody in a fortnight
- [x] A worked example on the landing page, labelled as an illustration
- [ ] Take the "In build" marker off the Find section — it must not be there
      when real users arrive, so either the 360Giving corpus lands first or the
      section comes out
- [ ] Replace the placeholder line-character art. It is no longer on the
      landing page (the product's own charts carry the hero instead) but it
      still fronts three empty states. Finding from a generation pass, worth
      keeping: **raster art cannot carry this product's dark mode.** Every
      colour in `Figure.tsx` is a CSS variable that flips; a PNG does not,
      so shipped art needs either light/dark pairs (which a generator will
      not produce as a consistent inverted twin) or a single-colour alpha
      mask tinted by `currentColor` — which themes perfectly but gives up the
      two-tone accent. Generated images are therefore reference for
      hand-authored SVG, not the asset itself
- [ ] Decide whether the empty states want a character at all. Replacing the
      hero figure with the product's own chart made the landing page markedly
      better; an empty tracker may be better served by a small diagram of what
      will appear there than by a figure
- [ ] A title that reports a finding on more screens than the tracker — today it
      is the only one that earns a highlighter

### Found while building Phase 12
- [x] Fix the deadlock: `withAdmin` inside `withTenant` hung `/tracker`,
      `/opportunities/[id]` and the calendar export forever whenever
      `ANTHROPIC_API_KEY` was absent from the environment
- [x] Guard `withAdmin` so the same mistake throws instead of hanging
- [ ] Seed a demo fund that is genuinely behind, so the overrun state is
      visible without a harness

## Phase 11 — Hardening
- [ ] Upgrade vitest/vite (dev-only advisories: esbuild dev server, postcss via next)
- [x] WCAG 2.2 AA audit with axe across all eighteen screens —
      `npm run accessibility`, signed out, as a customer and as an operator
- [x] Fix `link-in-text-block`: nine inline links across six screens were
      distinguished by colour alone (WCAG 1.4.1)
- [x] Fix an invalid `<dl>` on the console overview
- [ ] Run the axe sweep in CI. It needs a dev server and a browser, so it is a
      separate step from `npm test` rather than part of it
- [x] Security review of the console, settings and ingestion work. Found and
      fixed a credential-exfiltration path I had introduced the same day: an
      editable Companies House base URL would have let an admin redirect the
      key off a request, defeating the encryption that makes it write-only
- [x] Keyboard focus visibility across seven screens
- [ ] Security review of the older surface (documents, applications, export)
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
