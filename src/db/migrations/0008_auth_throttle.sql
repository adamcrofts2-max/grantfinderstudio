-- Failed sign-in attempts.
--
-- ADMIN scope, for the same reason sessions are: this is read before anybody
-- is anybody, and it is part of deciding whether they get to be. Revoked from
-- PUBLIC, never granted to app_user.
--
-- `id` is a hash of the thing being limited, prefixed by which axis it is, so
-- the table is not a plaintext list of who has been trying to sign in and from
-- where. That is a meaningful improvement over storing addresses in the clear
-- rather than a strong one — an email address is a small enough space to
-- brute-force from a hash — but this table holds nothing an attacker could not
-- work out anyway, and it costs nothing to not keep the list.
CREATE TABLE auth_attempts (
  id                text PRIMARY KEY,
  attempts          integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now()
);

-- Lapsed rows are swept in bulk.
CREATE INDEX auth_attempts_window ON auth_attempts (window_started_at);

REVOKE ALL ON auth_attempts FROM PUBLIC;
