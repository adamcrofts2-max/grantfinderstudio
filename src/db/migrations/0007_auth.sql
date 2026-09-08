-- Accounts and sessions.
--
-- Everything in this file is ADMIN scope, and that is the whole point.
--
-- A session is read BEFORE the tenant is known — reading it is what
-- ESTABLISHES the tenant — so it cannot itself be protected by a policy that
-- depends on the tenant already being set. The same goes for the password
-- hash, which is checked before anyone is anybody. Both therefore follow the
-- operator-credentials rule from 0002: revoked from PUBLIC, never granted to
-- app_user, reached only through withAdmin.
--
-- This is also why the password hash does NOT live on `users`. 0001 ends with
-- `GRANT SELECT ON users TO app_user`, and that table carries no policy, so
-- any tenant connection can read every row of it. A hash column added there
-- would be readable by every signed-in customer of the platform.

CREATE TABLE user_passwords (
  user_id       text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON user_passwords FROM PUBLIC;

-- `id` is the SHA-256 of the session token, never the token itself. The token
-- exists only in the holder's cookie, so a copy of this table does not let
-- anyone sign in as anybody: there is nothing here to replay.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  user_id      text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id ON sessions (user_id);
-- Expiry is swept in bulk, so it wants its own index.
CREATE INDEX sessions_expires_at ON sessions (expires_at);

REVOKE ALL ON sessions FROM PUBLIC;

-- Sign-in normalises the address before it looks anyone up, so two accounts
-- differing only in case would make one of them unreachable — and which one
-- would depend on row order. The existing UNIQUE (email) does not prevent it.
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- The session records which organisation it is acting as.
--
-- This is what keeps the per-request lookup to ONE query against a table the
-- tenant role cannot see. The alternative — resolving the organisation from
-- memberships on every request — would need a tenant context in order to read
-- the very row that establishes the tenant context.
--
-- Nullable because a brand-new account has no organisation until onboarding
-- creates one. A session with no organisation can reach onboarding and nothing
-- else.
--
-- Because the organisation is captured here rather than re-derived, removing
-- someone from an organisation must also delete their sessions for it.
-- Revocation is an event, not something re-checked on every request.
ALTER TABLE sessions
  ADD COLUMN organisation_id text REFERENCES organisations(id) ON DELETE CASCADE;

CREATE INDEX sessions_organisation_id ON sessions (organisation_id);

-- Reading your OWN memberships cannot require already knowing which
-- organisation you are in — that is precisely what the read is for. So
-- memberships gains a second way in, keyed on the user rather than the tenant.
--
-- Postgres ORs permissive policies together, so this widens SELECT only, and
-- only to rows that are already yours. Writes stay on the tenant policy alone.
-- Set app.user_id the same transaction-local way as app.organisation_id, so it
-- cannot outlive the request that set it.
CREATE POLICY own_memberships ON memberships
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true));
