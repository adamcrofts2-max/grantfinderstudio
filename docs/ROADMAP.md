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
- [x] Persisting awards and licence to the database — `replaceFunderAwards`
      writes the awards, `source_datasets` carries each publisher's licence and
      attribution, and the corpus load reads the licence from `data_license` on
      their own grants rather than asking anybody to supply it
- [x] Licence rendering in the UI — `/grants` and `/funders` both carry the
      publisher's own licence line, and a funder with none is skipped, not stored
- [ ] Export gating on licence. Nothing to gate yet: there is no DOCX/PDF
      export (Phase 8), and "Copy all answers" copies the applicant's own prose
      rather than any publisher's rows. Do it with the export, not before

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
- [x] **Readiness breakdown** (completeness, never a success probability). The
      engine always returned seven components with a score and a sentence
      each; the card showed the average alone, so a number moved with nothing
      on screen saying what moved it. Each part now shows its own bar, its own
      percentage and its own next step, with a caption naming which of them
      the average covers — a part that cannot be measured is marked uncounted
      rather than scored zero

**Step 2 — a human of the applicant's choosing (free, no supply side needed)**
- [x] **The audit trail** (migration 0022, `src/db/audit.ts`). `audit_logs` was
      the fifth and last table 0001 created with no writer, and the third
      bullet below cannot be honoured without it. Twenty tenant-facing actions
      write to it, in the same transaction as the change so the trail can never
      record something that rolled back; the vocabulary is closed in the domain
      so twenty call sites cannot invent three spellings of one event;
      `metadata` carries shape and never answer prose; and 0022 adds
      `application_id` as a column so a reviewer given one application cannot
      be shown the organisation's others. Read on the application page, folded
      away, newest first
- [x] **Share an application read-only for review** (migrations 0023/0024,
      `src/db/shares.ts`, `/review/[token]`). The reviewer's page carries the
      four things named here — the answers, the fact behind each claim, the
      unsupported-claim flags, and the eligibility verdict phrased for a
      reader rather than for the applicant. It shows nothing else of the
      organisation: not its other applications, not its fact base, not its
      documents, and it carries no form, so a leaked link can only read the
      one application it names
- [x] **Scoped, time-boxed, revocable, audited access.** One application. An
      expiry required by the column as well as the form, chosen from 7/14/30
      days with no "never". Withdrawal in one click, taking effect on the next
      request, keeping the row as the applicant's own record. And every read
      recorded: on the share row every time, in the audit trail once per visit
      so a reviewer refreshing cannot push the application's own history off
      the screen. Only the token's SHA-256 is stored, so the table is not a set
      of working links and a lost link is replaced rather than recovered —
      which the panel says. 0024 is the other half: `FORCE ROW LEVEL SECURITY`
      binds the table owner too, so a reviewer's lookup reads the one row whose
      token it is holding, by putting that hash in `app.share_token_hash` for
      one transaction, and nothing else
- [x] **Structured comments a reviewer can leave against a specific answer**
      (migration 0025, `src/db/comments.ts`). A box under each answer and one
      for the application as a whole, because "the budget does not match what
      answer 3 promises" belongs to neither one answer nor a footnote. The
      applicant sees them beside the question they are about, marks each one
      dealt with without losing the words, and every comment writes an audit
      line. Bounded in three places, since a link is a bearer token: the text
      and a fifty-per-link cap in `checkComment`, the length again in the
      column. The reviewer's text is untrusted — escaped on the way to a
      screen, never spliced into a prompt — and one link shows its own
      holder's notes and nobody else's
- [ ] Decide whether a reviewer's sign-off is recorded as provenance or stays
      advisory (leaning: recorded — a reviewer's judgement is the strongest
      provenance the product could carry)
- [ ] Show the reviewer what has happened to the application, as the applicant
      sees it. The trail is already selectable by application and already
      tenant-scoped; what stops it is that its actor column says "by you" or
      "by a colleague", and a reviewer is neither
- [ ] Let the applicant extend a live share rather than withdraw it and make
      another (the second link is a second thing to keep track of)
- [ ] Tell the applicant a comment has arrived. Today they find out by opening
      the application, which is fine for somebody working on it daily and no
      use at all for a review that lands a week later. There is no mail on the
      platform yet, so this waits on that decision rather than on the panel
- [ ] Decide whether the Critic may read the reviewer's comments. It would be
      the strongest context it could have — a human's actual objections — and
      it is text from outside the organisation, so it needs the treatment
      answer prose already gets (`keepCheckableFindings`, the instruction-like
      content report) rather than a paste into the prompt
- [ ] A reviewer cannot see a reply, only that something was dealt with. Decide
      whether a thread is worth it or whether "dealt with" plus the applicant's
      own email is the honest scope

**Step 3 — curated referral (revenue, no platform liability)**
- [ ] A short list of vetted bid writers; they contract directly with the CIC
- [ ] Referral fee rather than a take rate, so no payments stack is needed

**Step 4 — marketplace, only if steps 2 and 3 show the volume**
- [ ] Two-sided matching, vetting, ratings, disputes, DPAs with every reviewer
- [ ] Note the identity shift: software margins become services margins, and
      headcount starts scaling with revenue

**Also in this phase — what an application needs besides prose**
- [x] **Budget engine.** `budgets`/`budget_lines` written for the first time
      since 0001, `validateBudget` wired to the funder's own verified criteria
      through the new `restrictionsFromCriteria`, and the card names the two
      rules it CANNOT check rather than implying it did
- [x] **Outcomes table.** activity → output → outcome as three fields, because
      the distinction is what assessors read; indicator and target optional
- [ ] Carry a cost-category exclusion and an overhead cap as criterion kinds,
      so `validateBudget`'s last two checks can fire. Until then they never
      do, and the budget card says so
- [x] **Wire eligibility into readiness for real.** It was hardcoded
      `'eligible'` — so the card claimed "you meet every criterion we can
      check" on every application ever opened — and then `'unknown'`, which
      was honest and said nothing. The application query loads the profile and
      the project now and runs the engine, against THIS application's
      requested amount rather than the project's. `EligibilityReadiness`
      carries the counts with the verdict so the row can phrase itself: the
      three kinds of unknown are three different sentences, and the two that
      are not about this application score null rather than half marks
- [x] **Store reviews against the application** (migration 0019). The last of
      the four tables 0001 created with no writer. A review cost a model call
      and then lived in `useActionState`, so it was gone on navigation and
      working through a finding the next evening meant paying again
- [x] A stored review is shown with a date, the readiness it was read at, and
      a count of the answers edited since — because a finding quotes the words
      it is about, and a rewritten answer leaves the quote describing text that
      is no longer there
- [ ] Offer the earlier reviews, not only the latest. They are all kept, and
      "what did it say before I rewrote this" is a fair question

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
- [x] Fix the crash on confirming a company from the register. The fact key
      carried the company number and NO organisation, and the insert had no
      `ON CONFLICT`, so confirming twice threw — and two organisations could
      never confirm the same company, the second one crashing with
      "Application error: a server-side exception has occurred"
- [x] Walk the 360Giving ingest end to end on the production build against a
      stub over a real socket: console → dry run → load → the funder reaching
      a customer's prospect card with its website and both actions
- [x] **Read the applicant's own website** to propose facts. Most CICs have
      already written who they are, who they serve and where; typing it again
      is the slowest part of reaching the five confirmed facts the Writer
      needs. One page, unconfirmed facts, sourced to the URL
- [x] SSRF guard for any address a person supplies: https, public hostname, no
      credentials, no port, and — the control that actually matters — every
      RESOLVED address and every redirect checked as well. Proven over a real
      socket rather than by fixture
- [x] **Read the 360Giving API from its source and correct the search route.**
      Two live 404s came from guessing:
      `/api/experimental/CurrentLatestGrants` hangs off `api/` not `api/v1/`,
      and has no trailing slash. Their repo was clonable all along — the
      observation that ended the guessing
- [x] Remove the route-discovery machinery. It asked the API for an index of
      its routes on a 404, and could never have worked: `/api/` serves an HTML
      landing page and `/` their web UI, so there is no index anywhere. Three
      round trips to produce a worse message
- [x] Read the shape the corpus search actually returns — `funding_org_ids`,
      `publisher_org_id`, `additional_data` — not the `{ funders, publisher }`
      shape the per-organisation routes use. The first version read `null` for
      every funder
- [x] Show each grant's OWN licence, from `additional_data.metadata`.
      Publishers choose their own and some are share-alike, so there is no one
      licence for the corpus. The page listed publisher names instead, which
      was empty every time: their organisation refs carry an `org_id` and no
      name
- [x] **Accept that there is no public all-grants search, and hold the corpus
      instead.** The experimental route 404s on the live host and sits beside
      `control/trigger-datagetter`, so the non-`v1` tree is internal; their
      published docs list three endpoints and no search. Their own advice is to
      store the data locally, so that is what happens now
- [x] Walk `org/funder/` and load each funder's `grants_made/` into
      `funder_awards`, in bounded steps — the load cannot be one request, so it
      is a cursor, a deadline and a scheduler
- [x] Bound a step by TIME, not a funder count. A count has to be guessed
      against the slowest publisher in the list; a deadline does as much as the
      request has room for
- [x] Keep the licence rule while loading thousands of funders: read each
      publisher's licence from `data_license` on their own grants, and SKIP and
      COUNT a funder who states none
- [x] Bring the local grant search back, matching ANY term across description,
      title, recipient, region and tags, with trigram indexes where `pg_trgm`
      is available (the trigram half superseded by full text in 0015 — see
      below)
- [x] Fix the per-funder ingest, which had the same shape bug as the search: it
      handed the API's wrapper to the normaliser and would have rejected every
      real grant. The fixtures were written from the Data Standard rather than
      captured, so the tests agreed with it
- [x] An honest empty state on `/grants`: how much of the record has arrived,
      never "an operator loads a funder's grants from the console"
- [x] `npm run e2e` — a browser signs up, an operator loads the corpus from a
      stub 360Giving, and the applicant's search finds the grant with its
      amount, recipient and funder. Against the production build and real
      Postgres
- [ ] Find a funder by NAME, from a held copy of `org/` — the organisation
      lists declare no filter backends, so `?search=` is silently ignored and
      the whole list comes back. 100 requests/minute, 1000 a page
- [ ] "Organisations like mine": match recipients by name from the same held
      list, then `grants_received/` to show who funded them
- [x] **Make the record fill ITSELF.** Holding the grants is forced — there is
      no search to query — but an operator pressing buttons was not. Arriving
      at `/grants` starts the walk and advances it, under a database lease, in
      `after()` so nobody waits for it. No console, no button, no environment
      variable
- [x] Drop the secret from the step route. It made the load need configuring
      before it would run at all, and it was guarding public data being written
      to shared reference tables. The lease bounds cost and concurrency
      properly; the scheduler is recognised by `x-vercel-cron` and gets the
      long step
- [x] A restart is claimable at once — `startCorpusLoad` leaves `updated_at`
      NULL rather than `now()`, so somebody who asks for a re-read does not
      watch nothing happen for ninety seconds
- [x] **Never truncate a funder's record silently.** The cap was 2,000 grants
      and the `truncated` flag was dropped, so the biggest funders — the ones
      that matter most — had their medians, quartiles and ranges computed from
      a cut record. Cap raised to 30,000 and, more importantly, counted
- [x] **Chain the steps.** The first real run did 16 funders in four and a half
      hours, because only a daily cron and passing visitors advanced it — four
      days for 355 funders. A step with more to do now asks for the next one,
      under the same lease
- [x] Report the corpus SIZE, with indexes, on `/api/corpus`. The number that
      decides the database tier was never going to be estimated from a row
      count
- [x] Watch the size as the walk completes. 355 funders at ~683 grants each is
      about 240,000 rows with three GIN indexes, which will not fit a 0.5 GB
      tier — decide the tier before it becomes a surprise. **Measured on 20,000
      real rows: 57 MB with the trigram indexes, 33 MB with one tsvector index,
      31 MB with none.** Answered by the two items below rather than by paying
      for a tier
- [x] **One full-text index instead of three trigram indexes** (migration
      0015). The trigram indexes were 26 MB per 20,000 grants — larger than the
      grants. A `search_vector tsvector` column over title, description,
      recipient, region and the classification tags, filled by a trigger so no
      writer can forget it, and every term queried as a prefix (`somer:*`) so
      half a word still finds Somerset. Stemming makes plurals better than
      trigrams ever were; what is lost is matching the middle of a word
- [x] **Hold the last three years, and count what that drops** (`RECENT_YEARS`,
      migration 0016). ~240,000 rows was ~420 MB even with one index, which no
      free tier holds; three years is about a quarter of the rows and still
      leaves almost every active funder characterisable. Saves STORAGE and NOT
      fetch time — their API declares no date filter, so the old grants are
      fetched, read and dropped. `awards_discarded` is on the record and on the
      admin panel, because the page cap taught what an uncounted cap costs
- [x] Delete what was stored before the window existed (migration 0017), so
      the page's "from the last 3 years" is not printed over a grant from 2015.
      Derived, re-fetchable open data only — and a grant with no award date is
      kept, because a missing field is not evidence of age
- [x] Measure the SEARCH, not just the storage: at 65,008 grants a full search
      page is ~470 ms of database work (`searchAwards` 78 ms, `facetsFor` 251,
      `funderSummaries` 139), and the compacted corpus is 69 MB. Rig kept as
      `search-latency.probe.test.ts`, skipped unless pointed at a database
- [x] **Give somebody a box to write the answer in** (`saveOwnAnswerAction`).
      Found by walking the product: each question offered one action, "Draft
      from my facts", so on a deployment with no Anthropic key — the default —
      the central screen had nothing a person could do with a parsed form. The
      copy promised otherwise on three screens, the tracker's whole effort
      model assumes it, and `saveAnswer` was already in the data layer. Writing
      your own words CLEARS the Writer's sentence tracing, because tracing
      describes text the Writer produced and nothing else
- [x] **A chosen filter always stays on screen**, whatever its count. It used
      to erase itself: pick a band no matching grant falls in and the chip
      vanished while the header went on saying "narrowed by 1 filter — tap a
      filter again to remove it", over a row with nothing to tap. A control is
      the only handle on the state it created
- [x] **The opportunity card no longer claims an effort the fund's own page
      refuses to give.** It said "£30,000 for about 1 hour of work · LOW
      EFFORT" where the fund page said "an unknown amount of work — nobody has
      seen this funder's form yet". Features and `featuresKnown` now come from
      one call (`applicationFeaturesFor`) so they cannot drift again, the
      figure and the badge both defer to it, and a verdict of unknown with no
      criteria at all says so rather than reporting "0 open questions to settle"
- [x] **Count a funder the walk cannot read** (`funders_failed`, migration
      0018). The third and last uncounted way for the corpus to be short: a
      failure wrote `last_error`, one slot the next success cleared, so three
      publishers vanished behind a panel reading "42 of 42 — 100%, records cut
      short 0". Counted, named, and shown beside the other two
- [x] **Rank the search by relevance, not by date** (migration 0020). Measured:
      "youth skills somerset" matched 61% of the corpus and showed five
      "Chapel roof repair" grants first, because every field weighed the same
      and the chapel grants went to "Wells Youth Collective". Weighted vector,
      `ts_rank` ordering on the fetch, and field weights in `relevance`
- [x] **Put a relevance threshold on the COUNT, not just the order**
      (`RELEVANCE_FLOOR`, one tenth of the best match — the same ratio Postgres
      gives a D-weight hit against an A-weight one). It lives in `buildWhere`
      beside the text predicate, so the list, the total, every facet count,
      each funder's tally and each funder's examples all carry it. Measured:
      "youth skills somerset" 284 matches → 49, 61% of the corpus → 10%
- [x] **One floor PER TERM, not one for the query.** A browser walk found the
      single floor had made a place name inert: "youth skills" and "youth
      skills somerset" returned the same thirty rows and offered no Somerset
      chip, because the bar came from the best title match and a region is
      weight D. Now 90 and 109, with Somerset the first chip offered. Costs
      414 → 453 ms at 59,904 grants for three terms
- [x] **Drop `funder_awards_text_idx`** (migration 0021). 0015 replaced the
      ILIKE search with a tsvector and dropped its own three trigram indexes,
      but missed this one from 0012. Measured: 0 scans ever, and 24 MB of an
      86 MB table at 59,776 grants — nearly three times the tsvector index
      doing the actual work. 86 MB → 63 MB
- [ ] Give the floor a way to say it acted. A grant that mentions one of your
      words in passing is now absent with no explanation, and the only person
      who would notice is the one looking for that grant. Knowing how many
      were left out costs a second count, which is the query this phase is
      already trying to run once
- [x] **Weight words by how much they narrow** (`textSearch`, inverse document
      frequency). Reported: "community tree nursery somerset shows a lot of
      irrelevant results". Measured: it returned 218 of 464 grants, which is
      exactly the number matching `community` — one word carried the whole
      result and the tree nursery was seventh in it. Each word now contributes
      `idf × rank / best_rank_for_that_word`, normalised so a rare place name
      is not crushed by the D weight on region. 47% of the corpus -> 8%, led by
      the right grant. Costs the page 453 -> 548 ms at 59,392 grants; an
      eight-word query got faster
- [x] **Name the words that matched nothing.** `food bank leeds` matches
      `bank` and `leeds` zero times on this corpus, and the page said nothing
      about it — so a result that was really just "food" read as broken.
      Counted over the corpus, not the result, so it separates "we hold none of
      these" from "your filters removed them"
- [ ] Re-measure ranking against real 360Giving prose. The stub draws from
      fifteen work descriptions, so scores cluster (8, 4, 1) in a way real
      grant text would not — and the floor's effect depends on that spread:
      it cut "youth skills somerset" from 284 to 49 and left "mental health
      young people" at 252, because on this corpus those 252 really do all
      mention one of those words
- [x] **Fix the hydration bug that WAS in the product.** `ReviewPanel` is
      `'use client'` and computed "3 minutes ago" from `Date.now()` during
      render — two clock readings, server and hydration, so a load straddling a
      minute tick mismatched. The page reads the clock once and passes the
      phrase down; `since()` lives in `src/domain/time/` and takes `now`
- [x] **Group the search by who RECEIVED the grants** ("Who got them", the
      third view on `/grants`). Asked for: "search via similar CICs and see the
      past grants they've been awarded". Each row is an organisation with what
      it raised, its typical and largest grant, its regions, and THE FUNDERS
      WHO BACKED IT — which is the actionable part. Grouped on a normalised
      name because 360Giving publishes no reliable recipient id, and the
      heading states the condition ("if your search describes your own work")
      rather than claiming a similarity model we have no data for
- [x] **Order the peer list by FIT, not by total raised.** A walk as a Somerset
      CIC asking £18,000 was led by a body that had raised £2,861,780,
      "typically £487,710", on a screen headed "organisations like yours".
      Size band, then repeat funding, then their own area, then total — with
      every key on the row in words ("about your size"), and no size claim at
      all until an ask exists
- [x] **Name the grants when a funder has too few to summarise.** A precise
      search matches one or two grants per funder, so `canCharacterise`
      declined and nothing replaced it: fourteen rows reading "1 grant like
      yours · gave within the last year", nine identical, no amounts anywhere.
      `funders.ts` already said the figures should be "given as what they are:
      a couple of grants, named, not a pattern" — written down, never
      implemented
- [x] **The first search is asked about the WORK, not the beneficiary list.**
      Walked as a community tree nursery in Somerset, the product's own opening
      question was "young people older people Somerset" — the only boxes the
      onboarding list offers an environmental CIC — so it led with a youth
      trust and the woodland funder that had made seventeen tree-nursery
      grants was absent. `defaultSearchText` takes the project's own name and
      its most-repeated description words, and keeps the groups as the fallback
      for a project that describes itself thinly
- [x] **"Funded your kind of work" reads the grant text, not only its label.**
      The same fault one layer down: `matchesCause` compared 360Giving
      classification labels against beneficiary groups, and every
      environmental grant in a corpus carries the single word "Environment",
      which no applicant calls themselves. Award title and description now
      come with the awards, a description match is tracked separately from a
      label match (`workAwards`), and it outranks one inside a tier — a funder
      whose grants ARE the work above one that shares a category. Two words
      are required, because one was a coincidence: "grow" alone promoted a
      food-growing funder into a tree nursery's strongest prospects
- [x] **Pagination follows the origin it was given, not a hardcoded https.**
      `FORCE`-style strictness with nothing to show for it: against an `http`
      base — which the setting exists for, "a mirror or a staging copy" — every
      publisher with more than one page failed on its `next` link AND the rows
      already read were discarded, so three of thirteen publishers wrote
      nothing and were counted "could not be read". 45% of a local corpus,
      silently. The downgrade refusal is unchanged where the base is https,
      and the multi-page hop is now proved over a real socket
- [x] **A peer row drills through to that organisation's own grants.** The
      view named the funders who had backed an organisation like yours and
      gave no way to see what they actually paid for, which is the question
      the view exists for. `?recipient=` scopes the grant list by the same
      folded name the peer view groups by (one `recipientKey`, so a row always
      links to its own grants), the page says whose record it is showing, and
      the way back drops the scope. The row
      names its funders, which is the actionable part, but "show me those six
      grants" needs a recipient filter in the URL and the facets
- [x] **A load that has stopped no longer reports itself as loading**
      (migration 0026, `corpusStanding`). `isLoading` was
      `startedAt !== null && finishedAt === null`, which has two states where
      the truth has four: a walk that can never finish — the API unreachable,
      every step dying before it reads a publisher — showed applicants "We are
      building the grant record now … come back in a few minutes and there
      will be more" indefinitely. The missing fact was a second clock:
      `updated_at` is written by the lease BEFORE the work and is refreshed by
      any page visit, so it says only that a step was attempted.
      `progressed_at` is written only when a step read a funder or wrote a
      grant. Stalled is now named on the applicant's screen (which stops
      promising more), and on the console it is the one state that is a job,
      dated, with the error beside the button that retries. Demonstrated by
      killing the publisher: the step ran, failed, and the record stayed
      stalled; bringing it back walked 8 funders and went to complete
      - [ ] The React #418 on `/grants` still stands on its own — the page
        renders corpus progress AND advances it through `after()` on a
        `force-dynamic` route, so the HTML and the payload the client
        reconciles against fall either side of that write
- [x] **The e2e provisions itself.** It reported 23 failures of 117 this week,
      every one of them the rig describing itself — an admin account from the
      previous run (which removes the claim flow the console check needs), a
      corpus written by a different stub, and a lease still held. All of it was
      documented as a paragraph asking a human to clear three tables. It now
      resets them in a transaction, refusing any `DATABASE_URL` that is not on
      this machine; starts its own server on :3100 with its own stub URL and a
      claim secret it generates; refuses to run against a port that is already
      answering, or without a `.next` build; and kills its server's whole
      process GROUP afterwards — `npx next start` leaves `next-server` holding
      the port otherwise, which the second consecutive run found by
      health-checking the orphan from the first
- [x] **The React #418 has a mechanism and a fix, on reasoning rather than on
      a reproduction.** Only one code path revalidated `/grants`: the admin's
      corpus step, which chains — and every e2e run that produced the error
      was one where that action fired, while three deliberate attempts to
      provoke it (≈130 navigations, corpus written concurrently by other
      means, production build and dev build) never saw it. `/grants` is
      `force-dynamic`, so revalidating it buys nothing; what it does is
      invalidate the client router cache of anybody holding the page, which
      makes a client re-fetch the payload for a page it is mid-hydration on
      and reconcile HTML from one moment of a load against a payload from
      another. The call is gone and `grants-dynamic.test.ts` holds the premise
      it rested on
      - [ ] Watch it. The evidence is circumstantial — consecutive clean e2e
        runs, not a reproduction — so if #418 returns, the next suspect is the
        page rendering corpus progress it is itself advancing through
        `after()`, and the fix there is to stop rendering a number the same
        request is changing The e2e named it:
      `/grants?q=1&text=youth`, which is `force-dynamic` over the corpus and
      starts a corpus step itself through `after()`. Three sightings, all
      inside a load; zero in ~130 navigations on a settled one. React recovers
      by re-rendering so nothing a user sees fails, and the e2e now waits for
      the corpus to settle — but two attempts at a reproduction missed the
      window, so the mechanism is consistent and not demonstrated
- [ ] Give `relevance` a weight for the REGION field. The SQL vector has it at
      D and the in-memory ranker has no weight for it at all, so a typed county
      earns rank in the fetch and nothing in the final ordering — only the
      applicant's OWN region earns a bonus. Ties keep the SQL order so nothing
      is visibly wrong today, but "dorset youth" cannot put a Dorset grant
      above a youth-titled one anywhere else
- [x] **Moved the realistic 360Giving stub into the repo**
      (`scripts/stub-360giving.mjs`). 13 funders, 486 grants, 33 recipients,
      12 themes with their own prose, £500–£395,000, 16 grants outside the
      window and one publisher that cannot be read. Every field is drawn from
      its own stream of a per-grant FNV-1a seed — never a length, never
      `i * k` — and `--print` reports the distribution, so the degeneracy that
      twice made a ranking look correct is visible rather than inferred
- [ ] Materialise the text-matched set once inside `facetsFor`. It re-evaluates
      the text predicate about ten times, one per facet option, which is 251 of
      the 470 ms — and now that each term carries its own floor, an eight-term
      query spends 616 ms of its 1,118 ms there. Not urgent for the one-to-three
      words people actually type. Half a second is not a page anybody complains
      about — and it touches the counts, so it needs its own careful pass
- [x] Recency chips narrowed to 1 and 2 years, both inside the window. A
      five-year chip would have selected the whole corpus and read as a filter
      that does nothing, which teaches people the counts are decoration
- [x] **A publisher whose page 137 fails keeps the 136 pages already read.**
      The error used to propagate out of the walk and take the rows with it,
      so one 502 cost a funder's entire record and put them in "could not be
      read" with nothing to show. Now a failure AFTER the first page stops the
      walk, marks it truncated and reports what stopped it; the first page
      still throws, because nothing was read and "could not be read" is then
      exactly what happened. The replace-versus-merge question is answered by
      a count: a cut-short read may fill an empty shelf but never replaces a
      fuller record — demonstrated live, a healthy walk storing 117 grants and
      a broken re-walk keeping them rather than dropping to 48
- [ ] Readiness reads 83% on an application with one of three questions
      answered. The average is over the parts that apply, and three of the four
      counted parts were fully satisfiable without writing anything: budget,
      outcomes and word limits ("every answer so far is within its limit" —
      deliberately, and it scores 1 on a single answer). A percentage that says
      83% beside "2 questions still to answer" is the same card saying two
      things. Weighting Questions, or capping the headline while answers are
      missing, is a product judgement rather than a bug fix
- [ ] The beneficiary list has nothing for an environmental CIC. A tree nursery
      ticks "young people" and "the general community" because there is no
      other box, and those are then what the eligibility matcher and the
      funder tiers work from. The work words patch over it for search; the
      underlying model still has no notion of what an organisation DOES
- [ ] "See the grants behind this" on /funders shows the funder's matching
      grants but not which of them matched on the description rather than the
      label — the distinction the ordering now turns on
- [ ] Re-fetch the funders whose records were cut short, once the first pass is
      done, so their figures stop being wrong
- [ ] Re-fetch the funders in `failed_org_ids` too, for the same reason
- [ ] **Allow a non-https base URL for a mirror**, or stop offering one.
      `assertSameOrigin` demands https outright, so the console's own
      "change it only to point at a mirror or a staging copy" breaks on any
      non-https mirror at the second page of grants. Matching the base's
      protocol keeps the security property (no downgrade, no other host) and
      makes the documented setting usable
- [ ] Decide how fresh is fresh enough. Visits advance the record whenever
      somebody is about, and a daily cron covers a quiet week; nobody knows yet
      how long a full pass takes because nobody knows how many funders there
      are. Revisit once the first real pass reports a total
- [ ] Re-read funders already loaded, on a rolling basis, so a grant added by a
      publisher this month is found. Today a finished walk stays finished until
      somebody restarts it. This is also what keeps the three-year window TRUE
      over time: 0017 tidied what was stored before the window existed, but
      rows drift out of it as months pass and are only removed when their
      funder is next walked
- [x] **Narrow the results, with counted chips derived from the results.** Not
      checkboxes over a fixed taxonomy: the topics are each publisher's own
      free text, so a curated list would invent categories the data does not
      have. Size, recency, place and topic, each option counted as "what would
      I get if I picked this"
- [x] Seed the first filter from their own ask — "About what we need", half to
      double, one tap
- [x] Chips as links rather than checkboxes: no client JS, the URL carries the
      state, the back button undoes a filter, a narrowed search is shareable
- [x] Fold the filters away so results come first on a phone, opening by
      themselves once one is active; assert no sideways scroll at 390px
- [x] Name the distinct licences in the footer rather than one attribution line
      per publisher, which grew with the result set
- [x] Give the dev server its own `distDir`, so `next dev` can no longer
      clobber a production build and produce a phantom hydration error
- [x] **Group results by FUNDER**, the real unit of the decision — matching
      grants, typical size as an interquartile range, full range, when they
      last gave, how many went to your area, and the label they use most.
      Every grant is still one tap away, and the view is in the URL
- [x] Say why each funder is on the list, in the same clauses the ordering is
      built from, including the unflattering ones — "nothing published for 7
      years" appears on the row
- [x] Refuse to summarise a funder below MIN_AWARDS_TO_CHARACTERISE: name the
      grants instead of inventing a median over three of them
- [x] Carry the chosen view through a filter tap. Filtering used to bounce you
      from the grant list back to the funder list
- [x] Count zero "in your area" when the applicant has no area — `ILIKE '%%'`
      matched every row and would have told everyone that every funder works
      where they are
- [x] Enforce the design tokens: every `var(--x)` in globals.css must exist. An
      undefined custom property is silent — it made the selected tab black on
      black through a clean build, lint and test run
- [x] **Name the facts still needed**, with why a funder wants each, instead of
      "(4 of 5)" beside a page reading "Everything is checked". The prompt
      carries the claim into the form so nobody answers the question twice
- [x] Put discovery INTO the guided journey: "Add a fund you are considering"
      assumed you arrive with one in mind, and the two screens that answer
      "who would fund us" were behind a folded navigation
- [x] Cross-link `/funders` and `/grants`, each saying which question it
      answers. A person who found one had no way of knowing the other existed
- [x] `npm run walk` — sign up as a CIC, follow the guide, and print what is
      actually in front of a person at each screen. Found all three of the
      above; no assertion would have
- [ ] **Decide: merge `/funders` and `/grants` into one searchable screen.**
      `/funders` is the better screen (evidence grouping, the amount-fit bar,
      "what this is and is not") and `/grants` is the better query (words,
      filters, counts). Two screens answering one question is a product
      decision, not a bug — but it is the next big simplification
- [ ] Sort the funder list by something the reader picks — most recent, biggest
      typical grant, most grants — rather than only by our own ranking
- [x] Refuse a rolling deadline that carries a date. The tracker showed "Tue,
      1 Dec 2026" beside "No deadline" on one row — found by walking the
      product with contradictory input, which a real person will also do
- [x] Walk the second half — fund, tracker, applications — in `npm run walk`.
      Discovery had been polished; the half the product exists for had never
      been exercised end to end
- [x] **Walk the Writer**, against a stub that speaks the Anthropic wire
      format and cites the fact ids out of the prompt. Paste, split, draft,
      provenance, copy out — all of it now exercised outside production
- [x] One definition of what a drafted sentence stands on (`claimStanding`,
      three states). The workspace counted every uncited sentence as
      unsupported while the action reported everything traced — one card said
      both, and would have on nearly every real draft
- [x] `draftSummary` as a pure function, so the sentence and the counts cannot
      disagree — and so "every claim traced" is never said of a draft that
      cited nothing
- [x] **Stop caching a failed database handle.** A rejected promise was cached
      for the life of the process, so one cold start against a sleeping
      Postgres left an instance answering "the database is not available" for
      ever. Found because the local database died mid-walk
- [ ] Run the Writer against the REAL model and read what it produces. The
      plumbing is proven; whether the prose is any good is a separate question
      and only the real thing answers it
- [ ] A critic pass and a review panel walk. `Review the application` was
      never clicked — the agents exist and are unit-tested
- [ ] Let a CIC not on Companies House reach `/funders` and `/tracker` sooner.
      Four pages silently redirect a half-set-up account to onboarding, which
      is right for tenant data and wrong for `/funders`, which is shared
- [ ] "See all 40 grants from this funder" from inside a funder row, rather
      than the three most recent
- [ ] "Check if they're open" — fetch the funder's own page on demand for the
      person who asked, extract whether anything is open and by when, keep the
      extraction private to that tenant. One page because a human asked, never
      a crawl
- [x] **Search 360Giving's whole corpus, live** — `/grants` asks the Data
      Store's own grant search rather than a local table an operator filled in
      one funder at a time. A person who came to look was being shown "no
      grants have been loaded yet": the honest report of a design that put an
      administrator between somebody and public data
- [x] Drop the organisation gate on `/grants`. `requireOrganisationId` sent a
      brand-new account to onboarding, so the one screen needing nothing but
      public data was the one screen you had to finish setting up to reach
- [x] One funder, one row, however it is met: a funder found in the corpus is
      created under the id the ingest would use, so enriching it later lands on
      the same row rather than beside it
- [x] Searched the awarded grants (superseded by the live corpus search above,
      which covers every publisher rather than the ones held locally) — The product was
      showing funder-level medians and burying the individual grants behind a
      disclosure, when "who like us has been given money, how much, and by
      whom" is the question people arrive with. Text, area, kind of work and
      amount band, landing on "grants like mine" derived from the applicant's
      own details
- [x] Carry a grant's title and description through the ingest. Neither was
      read from the payload and the schema column was never written, so every
      text search over real ingested data matched nothing and looked like a
      working search
- [x] Set the region from the register. The address was flattened to one
      string and the county discarded, so anybody who looked their company up
      rather than typing it in silently got matching on cause and size only
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

## Found by walking the site as a user (2026-09-15)

Fifteen findings, four fixed in the same pass. The eleven below are friction
rather than faults, kept here rather than in a document nobody opens again.

- [ ] Finishing onboarding looks identical to not starting it: no tick on
      either card, no "saved", no forward action. The only way on is the
      collapsed "All sections" menu
- [ ] Two different "of 5" counters within 40px — the header counts journey
      steps, the button counts confirmed facts. One of them needs other words
- [ ] The step counter advances on navigation: opening an application took it
      from 3 of 5 to 4 of 5 with nothing answered
- [ ] "Add one in Settings", on the Writer's no-key message, points the
      APPLICANT at `/admin/settings`, which is the operator console. It should
      name who can fix it instead
- [ ] A fund typed in by hand is immediately flagged "last retrieved today and
      due a re-check". Freshness starts at `unknown` and the warning fires on
      that, so the newest record in the product is the one it doubts most
- [ ] No second page of grants: "showing 120 of 284" and no way to the other
      164. The 120 rendered are 33 phone screens; `/funders` is 23. The
      compact by-funder view is 7 and is the one that works
- [ ] The nav's first item is labelled "Opportunities" and goes to `/`, the
      next-step dashboard. Ten flat entries also put "Search grants", "Who
      funds this", "Add a fund" and "Opportunities" in one ungrouped list
- [ ] Dates are formatted two ways: "2026-11-01" on the card and fund page,
      "Sun, 1 Nov 2026 · in 47 days" on the tracker. The tracker's is the one
      to keep
- [ ] Repeated classification labels print twice — "Somerset · Children and
      young people · Children and young people". De-duplicate the tags
- [ ] The add-a-fund success is grey body text under the button with no link
      to the fund, weaker treatment than a password-too-short error gets
- [ ] The loading banner repeats the whole 360Giving explanation on every
      search and still says "come back in a few minutes" at 95% loaded
- [ ] "Most recent award 0 months ago" on the fund page, where "this month"
      was meant; "Source: unknown" over figures from licensed grants; and the
      funder's top areas listed without saying how many are in the applicant's
      own area, which the shortlist two screens earlier does say
- [x] `npm run e2e` says what failed in its verdict, not only that something
      did. `E2E: FAILED` after eighty lines of `ok` is useless read through
      `tail`, which is how it gets read — one run cost a full re-run to find
      out why. The failures are repeated under the verdict now
