-- Opportunities the applicant brought themselves.
--
-- Research finding (PRODUCT_ARCHITECTURE.md §2.3.1): there is no
-- machine-readable source of open UK trust and foundation calls, and none is
-- coming. Find a Grant is ~120 grants and central government only; 360Giving
-- is awarded grants by design. So the pipeline starts with the applicant
-- pasting the funder's own guidance.
--
-- Such an opportunity must never be dressed up as a verified register entry.

ALTER TABLE opportunities
  ADD COLUMN origin source_type NOT NULL DEFAULT 'funder_published',
  -- The organisation that pasted it in, NULL for shared register data.
  -- Deliberately not tenant-scoped by RLS: opportunities are shared reference
  -- data, and a policy here would need a wider change than this migration.
  -- Until authentication lands, this column records intent, and the UI is
  -- what keeps a pasted opportunity attributed to the person who added it.
  ADD COLUMN added_by_organisation_id text REFERENCES organisations(id) ON DELETE CASCADE,
  -- The guidance text the opportunity was read from, so every criterion can
  -- be traced back to the wording that produced it.
  ADD COLUMN source_text text,
  ADD COLUMN instruction_like_content text[] NOT NULL DEFAULT '{}';

CREATE INDEX opportunities_origin_idx ON opportunities (origin, added_by_organisation_id);

-- A criterion carries the wording it was drawn from, exactly as a fact does.
-- Without the span, "verify this criterion" asks a person to take the model's
-- word for it, which is the one thing this product will not do.
ALTER TABLE eligibility_criteria
  ADD COLUMN source_span text,
  ADD COLUMN proposed_by source_type NOT NULL DEFAULT 'funder_published',
  -- Set when a person looks at a proposed criterion and says it is wrong,
  -- so it is neither used nor offered again.
  ADD COLUMN rejected_at timestamptz,
  ADD COLUMN rejected_by text;

ALTER TABLE eligibility_criteria
  ADD CONSTRAINT verification_is_complete
    CHECK ((verified_by IS NULL) = (verified_at IS NULL)),
  ADD CONSTRAINT rejection_is_complete
    CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
  -- A criterion cannot be both verified and rejected.
  ADD CONSTRAINT not_verified_and_rejected
    CHECK (verified_at IS NULL OR rejected_at IS NULL);

CREATE INDEX eligibility_criteria_verified_idx
  ON eligibility_criteria (opportunity_id, verified_at);

-- ---------------------------------------------------------------------------
-- Row-level security for opportunities a tenant added themselves.
-- ---------------------------------------------------------------------------
--
-- Until now `opportunities` was shared reference data: readable by everyone,
-- writable by nobody but the platform. Letting an applicant paste in their own
-- fund breaks that, and doing it with a blanket GRANT would leak one CIC's
-- research — which funds they are chasing, and the guidance text they pasted —
-- to every other tenant.
--
-- So: register rows (added_by_organisation_id IS NULL) stay readable by all,
-- and a pasted row is visible only to the organisation that added it.
--
-- Two policies rather than one, deliberately. A single ALL policy would let a
-- tenant's UPDATE match a register row through USING and then fail its WITH
-- CHECK, raising an error. Splitting reads from writes means a write simply
-- does not see rows it may not touch, and affects nothing.
--
-- ENABLE without FORCE here, unlike the tenant tables. The table owner is the
-- publisher of register data — migrations, seeding and ingestion all run as
-- the owner and must be able to write rows that belong to no tenant. On the
-- tenant tables FORCE is right because nobody should bypass; here the owner
-- bypassing IS the mechanism by which shared data exists.

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_or_own_read ON opportunities
  FOR SELECT
  USING (
    added_by_organisation_id IS NULL
    OR added_by_organisation_id = current_setting('app.organisation_id', true)
  );

-- Writes touch only your own rows, and cannot create one that pretends to be
-- register data: WITH CHECK requires the tenant id, so NULL is rejected.
CREATE POLICY own_write ON opportunities
  FOR ALL
  USING (added_by_organisation_id = current_setting('app.organisation_id', true))
  WITH CHECK (added_by_organisation_id = current_setting('app.organisation_id', true));

GRANT INSERT, UPDATE, DELETE ON opportunities TO app_user;

-- Criteria inherit their parent's visibility. A pasted fund's rules are as
-- private as the fund itself, and a tenant may not verify or reject a
-- criterion on shared register data — that would change what every other
-- organisation sees.

ALTER TABLE eligibility_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_or_own_read ON eligibility_criteria
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_id
        AND (
          o.added_by_organisation_id IS NULL
          OR o.added_by_organisation_id = current_setting('app.organisation_id', true)
        )
    )
  );

CREATE POLICY own_write ON eligibility_criteria
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_id
        AND o.added_by_organisation_id = current_setting('app.organisation_id', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_id
        AND o.added_by_organisation_id = current_setting('app.organisation_id', true)
    )
  );

GRANT INSERT, UPDATE, DELETE ON eligibility_criteria TO app_user;

-- Funders remain shared and read-only to tenants: a pasted opportunity reuses
-- an existing funder where the name matches, and creating a new funder row is
-- the platform's job. The application layer performs that insert on the admin
-- path.
