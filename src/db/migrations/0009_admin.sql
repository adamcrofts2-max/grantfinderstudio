-- The platform operator.
--
-- ## What an admin is here, and what it deliberately is not
--
-- An admin runs the SERVICE. They do not run anybody's funding bid. The
-- product's promise to a CIC is that its facts, documents and applications are
-- its own, and an admin console able to read them would make that sentence
-- false however carefully the console behaved. So the separation is not a rule
-- the application follows; it is a set of grants the database enforces.
--
-- `app_operator` is granted SELECT on platform tables ONLY. It is granted
-- nothing at all on any tenant table, so an admin page that tried to read
-- `facts` gets "permission denied for table facts" — a failure at the driver,
-- in every environment, whatever the code intended. There is a test for
-- exactly that, table by table.
--
-- The tenant tables are additionally FORCE ROW LEVEL SECURITY (0001), so even
-- the owning role sees nothing there without a tenant context. The operator
-- role makes that guarantee hold identically in development, where PGlite
-- connects as a superuser and superusers bypass RLS regardless of FORCE.
--
-- ## Why separate credentials rather than a flag on a user
--
-- A flag makes every ordinary account a potential admin account: one phished
-- customer password and the console is open. Separate credentials, a separate
-- cookie scoped to /admin, and a session measured in hours rather than the
-- 30 days a customer gets, mean an admin's own tenant account being taken does
-- not reach the platform at all.
--
-- There is deliberately NO sign-up. An admin console with a registration form
-- is a back door with a welcome mat. The first admin is claimed once, against
-- a secret held in the hosting environment, and only while no admin exists.

CREATE TABLE admin_accounts (
  id              text PRIMARY KEY,
  email           text NOT NULL,
  password_hash   text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_signed_in_at timestamptz,
  -- Set rather than deleted: an admin who is stood down should still be
  -- traceable in whatever they signed.
  disabled_at     timestamptz
);

CREATE UNIQUE INDEX admin_accounts_email_lower ON admin_accounts (lower(email));

-- Operator credentials, by the rule established in 0002 and 0007: read before
-- anybody is anybody, so revoked from PUBLIC and never granted to app_user.
-- Not granted to app_operator either — the console reads its own account
-- through the owner connection, and a role that could read password hashes is
-- not a role worth having.
REVOKE ALL ON admin_accounts FROM PUBLIC;

-- `id` is the SHA-256 of the session token, exactly as `sessions` is: the
-- token exists only in the holder's cookie, so a copy of this table replays
-- as nothing.
CREATE TABLE admin_sessions (
  id           text PRIMARY KEY,
  admin_id     text NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX admin_sessions_admin_id ON admin_sessions (admin_id);
CREATE INDEX admin_sessions_expires_at ON admin_sessions (expires_at);

REVOKE ALL ON admin_sessions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- The operator role.
--
-- Created the same defensive way as app_user in 0001: roles are CLUSTER-scoped,
-- so a plain CREATE ROLE fails the second time this schema is applied anywhere
-- in the same cluster, and `SET LOCAL ROLE` needs the connecting role to be a
-- member.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_operator') THEN
    CREATE ROLE app_operator NOLOGIN;
  END IF;
  EXECUTE format('GRANT app_operator TO %I', current_user);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- What an operator may read. Every one of these is the platform's own: who has
-- an account, what the shared catalogue holds, which migrations ran, and how
-- the sign-in limiter is doing. No tenant table appears here, and none may be
-- added without a corresponding change to the test that asserts their absence.
GRANT SELECT ON users TO app_operator;
GRANT SELECT ON auth_attempts TO app_operator;

-- `schema_migrations` is created by the migration runner rather than by a
-- migration, so it is absent wherever the schema is applied directly — the
-- test harness, for one. Conditional rather than assumed: a grant that fails
-- would take the whole deployment with it.
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT ON schema_migrations TO app_operator';
  END IF;
END $$;
GRANT SELECT ON source_datasets, funders, funder_awards, opportunities,
  eligibility_criteria TO app_operator;

-- ---------------------------------------------------------------------------
-- Closing a grant that was always wider than it needed to be.
--
-- 0001 ends with `GRANT SELECT ON users TO app_user`, and `users` carries no
-- policy — so the tenant role could read every account on the platform, names
-- and addresses included. Nothing on the tenant path has ever read that table:
-- sign-in, sign-up and session loading are all operator-scope by design
-- (0007), and the only reader is `src/db/auth.ts`, which runs through
-- withAdmin.
--
-- Not exploitable as it stood — there is no route that puts arbitrary SQL on
-- the tenant connection — but a grant nothing uses is a grant that should not
-- exist, and this one holds the platform's whole customer list.
-- ---------------------------------------------------------------------------
REVOKE SELECT ON users FROM app_user;
