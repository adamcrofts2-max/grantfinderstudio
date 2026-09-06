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

**5. Add the API keys** at `/settings`. Each is tested against the provider as
you save, so "Connected" means it genuinely works rather than merely that
something was stored.

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

With no `DATABASE_URL` the app runs on PGlite in memory — real PostgreSQL
compiled to WebAssembly, seeded with fictional demo data, lost on restart. Good
for development, never for production; the health check says so.

## Backups

Neon and Supabase both provide point-in-time recovery on paid tiers. Turn it on
before real organisations enter real data. Grant applications represent weeks of
someone's work.
