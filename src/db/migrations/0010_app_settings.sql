-- Operational settings for the platform's outbound services.
--
-- `app_credentials` (0002) holds SECRETS: encrypted, write-only, masked when
-- shown. This holds the things that are not secret but still have to be
-- changeable without a redeploy — a base URL pointed at a mirror, a page cap
-- raised for an unusually large publisher.
--
-- Two tables rather than one because the handling genuinely differs. A secret
-- is encrypted, never returned, and replaced rather than edited. A setting is
-- read back, shown in full, and edited in place. Storing them together would
-- mean every read path had to remember which kind it was holding.
--
-- Platform scope, by the rule established in 0002 and 0007: revoked from
-- PUBLIC, granted to no application role, reached only through the owner
-- connection. `app_operator` is not granted it either — the console reads
-- these through the same owner path that writes them, and a role that could
-- rewrite the base URL of an outbound request is a role worth not having.
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text REFERENCES admin_accounts(id) ON DELETE SET NULL
);

REVOKE ALL ON app_settings FROM PUBLIC;

-- 0002 records who changed a credential as a `users` id, from when the
-- settings screen lived in the tenant app and there was no such thing as an
-- admin account. It is the wrong table to point at now: the screen has moved
-- to the console, and the person changing a platform key is an admin, not a
-- customer.
--
-- Dropped rather than migrated. The column has only ever been written by a
-- screen that was reachable without signing in at all, so its contents cannot
-- be trusted to mean anything.
ALTER TABLE app_credentials DROP COLUMN IF EXISTS updated_by;
ALTER TABLE app_credentials
  ADD COLUMN updated_by_admin text REFERENCES admin_accounts(id) ON DELETE SET NULL;
