-- Sharing one application, read-only, with a person the applicant names.
--
-- Phase 9 Step 2. The roadmap's own words for what this has to be: "a named
-- outsider reading tenant data is a deliberate GDPR processor relationship,
-- not a toggle" — scoped, time-boxed, revocable and audited. The audit trail
-- (0022) came first because the fourth of those is not optional.
--
-- WHY THE TOKEN IS NOT IN HERE
--
-- Only its SHA-256 is, exactly as `sessions` stores a session. So a copy of
-- this table is not a set of working links: there is nothing in it to replay.
-- The token exists in the applicant's clipboard, in whatever they paste it
-- into, and nowhere else — which also means a lost link cannot be recovered,
-- only replaced, and the screen says so.
--
-- WHY `expires_at` IS NOT NULL
--
-- A link that works forever is a copy of the data handed out. Nobody revokes a
-- link they have forgotten about, and "no expiry" is the option that turns this
-- from a processor relationship into a leak with a URL. The column has no
-- default on purpose: a caller that forgets to set it gets an error rather than
-- a share that outlives the reason for it.
--
-- WHY `revoked_at` RATHER THAN A DELETE
--
-- The applicant's own record of what they did. A share that was withdrawn
-- three weeks ago is a fact about who saw what, and deleting the row would
-- take the view count and the dates with it — the very things somebody would
-- want if they ever had to account for the access.
CREATE TABLE application_shares (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- The SHA-256 of the token, base64url. Unique so a collision is a constraint
  -- violation rather than two shares answering to one link.
  token_hash       text NOT NULL UNIQUE,
  -- Who it was sent to, as the applicant wrote it. Not an email address and
  -- not verified: this is a label so they can tell their own shares apart and
  -- know whose access they are withdrawing.
  reviewer_name    text NOT NULL,
  created_by       text REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  -- Both ends of the reading, and a count. "Opened once, three weeks ago" and
  -- "opened eleven times, last night" are different facts about the same link.
  first_viewed_at  timestamptz,
  last_viewed_at   timestamptz,
  views            integer NOT NULL DEFAULT 0,
  CONSTRAINT application_shares_reviewer_named CHECK (btrim(reviewer_name) <> ''),
  CONSTRAINT application_shares_views_sane CHECK (views >= 0)
);

-- The applicant's own list, newest first.
CREATE INDEX application_shares_application_idx
  ON application_shares (organisation_id, application_id, created_at DESC);

-- The lookup every reviewer request makes. The unique constraint on
-- `token_hash` already provides the index; named here so the intent is on the
-- record rather than implied by a constraint.
COMMENT ON CONSTRAINT application_shares_token_hash_key ON application_shares IS
  'The reviewer lookup. One hash, one share.';

-- Tenant-scoped like every other table holding an organisation's own work, in
-- exactly the form 0001 uses: USING and WITH CHECK both, because USING alone
-- would let a tenant insert a share attributed to another organisation.
ALTER TABLE application_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON application_shares
  USING (organisation_id = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON application_shares TO app_user;

-- The operator role reads the platform's own tables and never a tenant's, and
-- 0009 revoked its access table by table. A new tenant table has to be added
-- to that refusal explicitly, or it would be the one thing the operator can
-- see — which `src/db/operator-scope.test.ts` asserts, table by table.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_operator') THEN
    EXECUTE 'REVOKE ALL ON application_shares FROM app_operator';
  END IF;
END $$;
