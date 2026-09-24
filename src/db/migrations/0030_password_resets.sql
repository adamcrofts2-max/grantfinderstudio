-- Password reset links.
--
-- ADMIN scope, for the same reason as `sessions` in 0007: a reset is used by
-- somebody who cannot sign in, so it is read before anybody is anybody, and no
-- tenant policy could protect it. Revoked from PUBLIC, never granted to
-- app_user or app_operator, reached only through withAdmin.
--
-- `id` is the SHA-256 of the token in the emailed link, never the token. The
-- token exists only in the recipient's inbox, so a copy of this table resets
-- nobody's password.
--
-- A link is used by deleting its row: one conditional DELETE ... RETURNING,
-- so two clicks on the same link cannot both succeed. Using one link also
-- deletes every other link for the same account.
CREATE TABLE password_resets (
  id          text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX password_resets_user_id ON password_resets (user_id);
CREATE INDEX password_resets_expires_at ON password_resets (expires_at);

REVOKE ALL ON password_resets FROM PUBLIC;
