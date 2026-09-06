-- Operator credentials.
--
-- These are the platform's own API keys, not a tenant's. CIC users never see
-- or supply them: they sign up and use the product, and the platform pays for
-- and manages its own provider access.
--
-- Deliberately NOT tenant-scoped and NOT covered by the RLS policies: no
-- application role may read this table at all. Only the server-side settings
-- code, running as the owner, touches it.

CREATE TABLE app_credentials (
  -- One row per provider, e.g. 'anthropic', 'companies_house'.
  provider        text PRIMARY KEY,
  -- AES-256-GCM ciphertext. Never plaintext, never returned to a browser.
  ciphertext      text NOT NULL,
  -- Display-only form such as 'sk-ant-…6789', safe to render.
  masked          text NOT NULL,
  -- Outcome of the last live check against the provider.
  last_checked_at timestamptz,
  last_check_ok   boolean,
  last_check_note text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      text REFERENCES users(id)
);

-- app_user is granted nothing here. The absence of a GRANT is the control.
REVOKE ALL ON app_credentials FROM PUBLIC;
