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
running app at `/settings`, verified against the provider, and stored
encrypted. Only the database URL and the encryption key are configuration.

## Steps

**1. Create the database.** Copy the connection string. It must request SSL —
append `?sslmode=require` if it does not already.

**2. Generate an encryption key.**

```bash
openssl rand -base64 32
```

Keep this safe. Changing it makes every stored API key unreadable and they
have to be entered again. It is not recoverable.

**3. Deploy.**

```bash
npx vercel            # first run links the project
npx vercel env add DATABASE_URL production
npx vercel env add APP_ENCRYPTION_KEY production
npx vercel --prod
```

Migrations run automatically on first database use. They are tracked in
`schema_migrations` and are safe to run repeatedly.

**4. Check it came up.**

```
GET https://your-app.vercel.app/api/health
```

`{"status":"ok","database":"ok","persistent":true,"problems":[]}` is what you
want. Anything else lists every problem at once, each with a fix.

**5. Protect the deployment before you put anything real in it.** There is no
authentication yet: anyone with the URL sees the organisation's data. In
Vercel, Settings → Deployment Protection → **Password Protection** (or Vercel
Authentication) covers the whole deployment and is a setting rather than a
sprint. Do this before step 6.

**6. Add the API keys** at `/settings`. Each is tested against the provider as
you save, so "Connected" means it genuinely works rather than merely that
something was stored.

**7. First run.** A real database starts completely empty — the demo funds are
seeded only into the in-memory dev database, so there is no fictional data and
no "demonstration data" banner. Go to `/onboarding` and either look your
company up on Companies House or, under **Enter your details yourself**, type
them in; then fill in **What you are trying to fund**. Both are needed: the
profile decides eligibility on legal form, and the project supplies the amount,
duration and beneficiary groups that three more criteria turn on.

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
| `COMPANIES_HOUSE_BASE_URL` | No | Points lookups at a staging endpoint |

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
