# Deployment

UK-hosted by default (`lhr1`), because the data is about UK organisations and
some of it is personal data under UK GDPR.

## What you need

| Thing | Where | Cost |
|---|---|---|
| Postgres | [Neon](https://neon.tech) or [Supabase](https://supabase.com) | Free tier is enough to start |
| Hosting | [Vercel](https://vercel.com) | Free tier is enough to start |
| Anthropic API key | [console.anthropic.com](https://console.anthropic.com/settings/keys) | Pay per use |
| Companies House API key | [developer hub](https://developer.company-information.service.gov.uk/) | Free |

The two API keys are **not** environment variables. They are entered in the
console at `/admin/settings`, verified against the provider, and stored
encrypted. Only the database URL, the encryption key and the one-time console
claim secret are configuration.

## Steps

**1. Create the database.** Copy the connection string. It must request SSL —
append `?sslmode=require` if it does not already.

**2. Generate an encryption key.**

```bash
openssl rand -base64 32
```

Keep this safe. Changing it makes every stored API key unreadable and they
have to be entered again. It is not recoverable.

**3. Generate the console claim secret.**

```bash
openssl rand -base64 32
```

This is what opens the one-time first-admin claim at `/admin/sign-in`. Without
it the claim never opens, which is the safe default: on a fresh deployment the
alternative is racing strangers for your own console.

**4. Deploy.**

```bash
npx vercel            # first run links the project
npx vercel env add DATABASE_URL production
npx vercel env add APP_ENCRYPTION_KEY production
npx vercel env add ADMIN_CLAIM_SECRET production
npx vercel --prod
```

Migrations run automatically on first database use. They are tracked in
`schema_migrations` and are safe to run repeatedly.

**5. Check it came up.**

```
GET https://your-app.vercel.app/api/health
```

`{"status":"ok","database":"ok","isolation":"enforced","persistent":true,"problems":[]}`
is what you want. Anything else lists every problem at once, each with a fix.
The response also reports which migrations have applied and which are pending.

**6. Claim the console.** Go to `/admin/sign-in`. While no admin exists and the
claim secret is set, it offers to create the first admin: your email address, the
claim secret from step 3, and a password of at least 14 characters. The moment
you claim it that form is gone for good — every admin after this one is added
from inside the console, at `/admin/admins`.

**7. Add the API keys** at `/admin/settings`. Each is tested against the
provider as you save, so "Connected" means it genuinely works rather than merely
that something was stored. Neither key is ever shown back to the browser after
it is stored.

**8. Load a funder** at `/admin/funders`, or the product has nothing to find. A
real deployment starts with no funders, no awards and no opportunities. Use
**Check first — writes nothing** before **Load this funder's grants**: the dry
run fetches one page and tells you what it saw without writing anything.

**9. First run.** A real database is empty — the demo funds are seeded only into
the in-memory dev database, so there is no fictional data and no "demonstration
data" banner. Sign up, then at `/onboarding` either look your company up on
Companies House or, under **Enter your details yourself**, type them in; then
fill in **What you are trying to fund**. Both are needed: the profile decides
eligibility on legal form, and the project supplies the amount, duration and
beneficiary groups that three more criteria turn on.

### Do you still want Vercel deployment protection?

Earlier versions of this document said to turn on Vercel's password protection
because the app had no authentication. It has since had its own: accounts,
sessions, per-organisation Row-Level Security, and a console behind separate
credentials. Deployment protection is now a choice rather than a necessity —
useful while the deployment is private and a nuisance the moment you want
somebody to sign up.

## Rehearsed against a real Postgres

This was run end to end against PostgreSQL 16 as a **non-superuser owner**,
which is the shape every managed host gives you. Three things only that
rehearsal could find, all now fixed:

- **`CREATE ROLE app_user` is cluster-scoped, not database-scoped.** A second
  database in the same Neon project would have failed migration 0001. Role
  creation is now idempotent, and it explicitly grants `app_user` to the
  connecting role, because `SET LOCAL ROLE` needs that membership on a host
  that does not hand out superuser.
- **`FORCE ROW LEVEL SECURITY` binds the table owner too.** Writing an
  organisation through the admin connection was refused. Every PGlite test had
  seeded as a superuser, which bypasses RLS entirely, so this was invisible
  until the app ran against a real database. Organisation, membership, profile
  and fact writes now go through the tenant path, where the policies are
  satisfied by construction; only the `users` row is the operator's.
- **`confirmCompanyAction` was an UPDATE.** On an empty database it changed
  nothing and reported success. Both routes into onboarding now create the
  organisation first.

## What to verify first

Two connectors have **never touched their real APIs** — they are blocked by the
build environment's egress rules and are tested only against recorded fixtures:

- **Companies House** — search a real CIC by name at `/onboarding`. Check the
  legal form reads "CIC limited by guarantee" or "limited by shares" and matches
  the register. This is the field the eligibility engine depends on most.
- **360Giving** — awarded-grants ingestion.

Fixture tests prove the shape of the code, not that the API agrees with it. The
Extractor passed 40 fixture tests while being completely broken against the real
API, so treat both as unverified until you have seen them work.

## How the database is used

The app connects as the schema owner and drops to the unprivileged `app_user`
role for every tenant transaction:

```
BEGIN
  SET LOCAL ROLE app_user
  set_config('app.organisation_id', …, true)
  … the request's queries …
COMMIT
```

Both settings are transaction-local, so a pooled connection cannot carry one
request's tenant into the next. Row-Level Security is enforced by Postgres, not
by application code — `src/db/rls.test.ts` and `src/db/client.test.ts` prove it,
including that the system fails closed when no tenant is set.

Operator credentials live in `app_credentials`, which `app_user` is granted no
access to at all. They are reached only through `withAdmin`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Production | Must request SSL |
| `APP_ENCRYPTION_KEY` | Always | 32 bytes base64 |
| `ANTHROPIC_API_KEY` | No | Turns on reading guidance and drafting for everybody. Without it the product still works — see below |
| `ADMIN_CLAIM_SECRET` | To use the console | At least 24 characters. Opens the one-time claim at `/admin/sign-in` |
| `COMPANIES_HOUSE_BASE_URL` | No | Points lookups at their sandbox. **Environment only** — see below |
| `THREESIXTYGIVING_BASE_URL` | No | Points ingestion at a mirror. Overridable live under Services |
| `THREESIXTYGIVING_MAX_PAGES` | No | Pages per ingest, default 50. Overridable live under Services |

### Neon needs no setup

Nothing has to be run by hand. Migration 0001 creates the unprivileged
`app_user` role that every Row-Level Security policy depends on, and the role
Neon gives you (`neondb_owner`) inherits `neon_superuser`, which carries
CREATEROLE. Point the app at the connection string and the first request does
the rest.

If a deploy ever does fail on `permission denied to create role`, the fix is
two lines in the Neon SQL editor, and the migration's guard steps over it
afterwards:

```sql
CREATE ROLE app_user NOLOGIN;
GRANT app_user TO neondb_owner;
```

### Check isolation is actually in force after the first deploy

`neon_superuser` also carries BYPASSRLS. That is harmless as things stand —
tenant queries run after `SET LOCAL ROLE app_user`, and BYPASSRLS belongs to
the role in effect, not the one that logged in — but if `app_user` ever
acquired it, every policy in the schema would stop applying and nothing else
would look any different. Silence is the danger, so `/api/health` asserts it on
every call:

```
{ "status": "ok", "database": "ok", "isolation": "enforced", ... }
```

`"isolation": "NOT ENFORCED"` means tenant data is readable across
organisations and the listed fix should be applied before anyone signs up.

### The pooled connection string is the right one

Neon's `-pooler` host runs PgBouncer in transaction mode, and everything this
app does is transaction-scoped by design: `SET LOCAL ROLE app_user`,
`set_config('app.organisation_id', …, true)` and `pg_advisory_xact_lock` for
migrations. A session-scoped equivalent of any of those would be taken on one
backend and released to whichever unrelated request borrowed it next, which is
why none of them are session-scoped. No named prepared statements either.

So use the pooler URL, which is what serverless wants. There is no need for a
separate direct endpoint for migrations.

`channel_binding=require` in a Neon connection string is a libpq directive.
node-postgres 8.23 does implement SCRAM channel binding, so the connection
should negotiate it, but this could not be tested from the build environment —
if the first deploy fails to authenticate, drop that parameter and retry before
looking anywhere else.

### Migrations apply themselves

The first request after a deploy runs any outstanding migrations, inside an
advisory lock so that several cold-starting instances cannot race each other.
There is no migrate step to run by hand.

### The per-origin rate limit depends on your proxy

Sign-in and sign-up are limited by origin as well as by address, and the origin
comes from `x-forwarded-for`. That header is also one a client can send, so the
limit is only worth anything where something upstream OVERWRITES it rather than
appending to it. Vercel does. If you move this behind a proxy that does not,
that axis can be evaded by forging the header and only the per-address limit
stands up — check before assuming.

### Environment variables need a redeploy, and Vercel's database integration is not for you

Two things that cost an afternoon on the first deploy:

**Variables added after a deployment do not reach the one already running.**
Set `DATABASE_URL` and `APP_ENCRYPTION_KEY`, then trigger a new deployment.
Without `DATABASE_URL` the app now refuses to start with a message saying so,
rather than falling back to the in-memory database — which is a devDependency
and fails to import in a deployed bundle, and which would be worse if it ever
did load, quietly accepting sign-ups into a database that vanishes on the next
cold start.

**Do not use Vercel's "Connect to a Database" / Neon storage integration** if
you have already set `DATABASE_URL` by hand. It exists to provision a new
database from Vercel and inject its own variable, so against an existing one it
just reports a name collision and asks for a prefix. Cancel it; the manually
set variable is all that is needed.

### The console, and claiming it

The operator console lives at `/admin`. It is not part of the product: separate
credentials, a separate cookie scoped to `/admin`, and a session that lasts
eight hours rather than a customer's thirty days.

**There is no sign-up.** An admin console with a registration form is a back
door with a welcome mat, so the first admin is claimed once and the route closes
permanently the moment it succeeds.

To claim it:

1. Generate a secret — `openssl rand -base64 32` — and set it as
   `ADMIN_CLAIM_SECRET`.
2. **Redeploy.** Variables added after a deployment do not reach the one already
   running.
3. Open `/admin/sign-in`. While no admin exists it offers the claim: your
   address, that secret, and a password of at least 14 characters.
4. Claim it. From then on the page offers sign-in only, and no route can create
   another admin.

Until `ADMIN_CLAIM_SECRET` is set the claim never opens, which is deliberate:
without it a freshly deployed console is a race between you and whoever finds
the URL first.

#### Loading the first funder

1. Redeploy, then open `/api/health`. It now reports **migrations**: how many
   have run and which are pending. Migrations apply themselves on the first
   request that touches data, so "deployed" and "migrated" are not the same
   event — and a deploy that cannot migrate fails in a way that looks like an
   unrelated bug on whatever page you happened to open.
2. Claim the console at `/admin/sign-in` if you have not already.
3. Find the funder on the 360Giving registry and note their **organisation
   identifier** (`GB-CHC-…`, `GB-COH-…`, `360G-…`) and their **licence** and
   **attribution**, from the publisher's own terms.
4. On **Funders**, type the id and press **Check first — writes nothing**. This
   fetches one page and reports how many grants the publisher has, how many of
   them we can read, and one example award. If that award is not the funder you
   meant, the id is wrong. Nothing is stored either way, so run it as often as
   you like.
5. Fill in the licence fields and press **Load this funder's grants**.
6. A funder needs at least five published grants before the product will
   describe them at all; below that they show as "too little published to say".

The dry run exists because a first ingest cannot otherwise tell you whether a
failure was the id, the network, the publisher or a bug in us.

#### Where API keys and service settings live

**Both are in the console, under Services (`/admin/settings`), and nowhere
else.** A CIC using this product is never asked for a key and has no screen
that could accept one.

Two kinds of thing, handled differently:

- **Keys** — Anthropic and Companies House. Encrypted with
  `APP_ENCRYPTION_KEY`, verified against the provider when saved, masked
  afterwards, never shown again.
- **Service settings** — base URLs and the page cap. Not secret, read back in
  full, edited in place. A value set in the console beats one from the hosting
  environment, because the console takes effect now and an environment variable
  needs a redeploy; each setting shows which is in force. Clear the box and
  save to fall back.

**A base URL for a keyed service is not editable from the console.** A key is
encrypted and never shown again so that it is write-only: nobody, admin
included, can read it back. An editable base URL would quietly undo that —
point Companies House at a host you control, wait for the next lookup, and the
`Authorization: Basic <key>` header arrives on your server. So
`COMPANIES_HOUSE_BASE_URL` stays an environment variable, which needs a
redeploy and leaves a trace in the hosting platform. A test enforces the rule
so it survives somebody adding a setting without reading this.

**360Giving needs no key.** It is an open, unauthenticated API — no token, no
registration — so it appears under service settings and not under keys.
Loading a funder's grants is on the Funders tab, and the publisher's licence
and attribution are typed there rather than guessed, because publishers choose
their own and some are share-alike.

#### What the console can and cannot see

It reads the platform's own tables — accounts, the shared catalogue, the sign-in
limiter, configuration — through a third database role, `app_operator`, which is
granted **nothing at all** on any tenant table. A console page that asked for an
organisation's facts or applications gets `permission denied` from Postgres.
That is not a policy in the code; `src/db/operator-scope.test.ts` asserts it
table by table, and a migration that granted the operator a tenant table would
fail the build.

So there are no per-organisation numbers on the console, and there cannot be.

### Running without an Anthropic key

The product is finishable end to end with no key at all, and the setup guide has
no step that a missing key can block:

- **Facts** — normally read out of documents you share. Without a key,
  `/organisation` has a form to type them in directly; they are recorded as
  "you told us" rather than as read from a document, and they count as
  confirmed.
- **Funds** — normally read from guidance you paste. Without a key,
  `/opportunities/add` leads with a form: who is offering it, what it is called,
  the deadline and the size. Eligibility for such a fund reads `unknown` rather
  than being invented, and everything else works — the tracker, the timing, the
  size check against what you are asking for.
- **The shared catalogue** — an operator can add funds every organisation sees,
  the same way, from `/admin/catalogue`. A deployment with an empty catalogue
  opens on an empty list for every new account, so this is the fastest thing to
  do after claiming the console.

What a key adds is the reading: proposed eligibility rules shown beside the
funder's own sentence, and drafted answers grounded in confirmed facts.

### First account on a new deployment

There is no seeded account in production: the demo data only exists on the
in-memory development database. Open `/sign-up`, create the first account, and
onboarding creates its organisation. Nothing else can be reached until it does.

With no `DATABASE_URL` the app runs on PGlite in memory — real PostgreSQL
compiled to WebAssembly, seeded with fictional demo data, lost on restart. Good
for development, never for production; the health check says so.

## Backups

Neon and Supabase both provide point-in-time recovery on paid tiers. Turn it on
before real organisations enter real data. Grant applications represent weeks of
someone's work.
