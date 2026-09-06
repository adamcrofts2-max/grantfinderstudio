-- Grant Finder Studio — initial schema.
--
-- Two classes of table:
--   TENANT-SCOPED  carry organisation_id and are protected by Row-Level Security.
--   SHARED         reference data (funders, opportunities, licences) readable by
--                  every tenant and writable only by the ingestion role.
--
-- Tenant isolation is enforced by Postgres, not by the application. Application
-- level filtering fails open when a WHERE clause is forgotten; RLS fails closed.

-- ---------------------------------------------------------------------------
-- Enums. These exist so that whole classes of mistake become unrepresentable.
-- ---------------------------------------------------------------------------

CREATE TYPE jurisdiction AS ENUM (
  'england', 'wales', 'scotland', 'northern_ireland', 'uk_wide'
);

CREATE TYPE legal_form AS ENUM (
  'cic_limited_by_guarantee', 'cic_limited_by_shares', 'charity',
  'charitable_incorporated_organisation', 'community_benefit_society',
  'company_limited_by_guarantee', 'company_limited_by_shares',
  'unincorporated_association', 'other'
);

-- How a funder treats the CIC legal form. 'not_stated' is deliberately a value
-- rather than a null: silence is a finding, and the product acts on it.
CREATE TYPE cic_treatment AS ENUM (
  'explicitly_permitted', 'charity_only', 'asset_locked_only',
  'limited_by_guarantee_only', 'no_share_capital_only',
  'permitted_with_conditions', 'not_stated'
);

CREATE TYPE freshness AS ENUM (
  'current', 'recently_verified', 'needs_verification', 'stale', 'closed', 'unknown'
);

-- Kept separate from the date itself so an estimate can never render as confirmed.
CREATE TYPE deadline_type AS ENUM (
  'confirmed', 'rolling', 'expected', 'estimated', 'unknown'
);

CREATE TYPE source_type AS ENUM (
  'user', 'document', 'companies_house', '360giving', 'funder_published', 'ai_extraction'
);

CREATE TYPE confidence AS ENUM ('high', 'medium', 'low');

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'editor', 'viewer');

CREATE TYPE application_status AS ENUM (
  'discovered', 'saved', 'eligibility', 'strategy', 'drafting', 'review',
  'submitted', 'awarded', 'rejected', 'reporting', 'complete'
);

CREATE TYPE review_mode AS ENUM ('standard', 'red_team');

CREATE TYPE cost_category AS ENUM (
  'staff', 'freelancers', 'equipment', 'materials', 'venues', 'travel',
  'training', 'marketing', 'evaluation', 'management', 'overheads', 'capital'
);

-- ---------------------------------------------------------------------------
-- Shared reference data. Not tenant-scoped.
-- ---------------------------------------------------------------------------

-- Every ingested dataset records its licence. 360Giving publishers choose their
-- own open licences and some are share-alike, which propagates to derived data.
-- Licence therefore travels with the data rather than living in a wiki.
CREATE TABLE source_datasets (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  publisher       text NOT NULL,
  licence         text NOT NULL,
  licence_url     text,
  attribution     text NOT NULL,
  terms_url       text,
  permitted_uses  text,
  retrieved_at    timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE funders (
  id              text PRIMARY KEY,
  name            text NOT NULL,
  website         text,
  jurisdiction    jurisdiction,
  -- Attributes the funder itself publishes, kept apart from anything derived.
  stated_priorities  text,
  -- Attributes we computed from awarded-grants data. Never presented as official.
  derived_summary    text,
  source_dataset_id  text REFERENCES source_datasets(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Awarded grants, from 360Giving. Evidence of what a funder actually funds.
CREATE TABLE funder_awards (
  id                text PRIMARY KEY,
  funder_id         text NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  recipient_name    text,
  amount_gbp        numeric(12,2),
  awarded_on        date,
  description       text,
  jurisdiction      jurisdiction,
  region            text,
  source_dataset_id text NOT NULL REFERENCES source_datasets(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX funder_awards_funder_idx ON funder_awards (funder_id);
CREATE INDEX funder_awards_awarded_on_idx ON funder_awards (awarded_on DESC);

CREATE TABLE opportunities (
  id                text PRIMARY KEY,
  funder_id         text NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  title             text NOT NULL,
  summary           text,
  min_amount_gbp    numeric(12,2),
  max_amount_gbp    numeric(12,2),
  jurisdiction      jurisdiction,
  deadline          date,
  deadline_kind     deadline_type NOT NULL DEFAULT 'unknown',
  freshness_state   freshness NOT NULL DEFAULT 'unknown',
  source_url        text,
  source_dataset_id text REFERENCES source_datasets(id),
  retrieved_at      timestamptz NOT NULL,
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- A confirmed deadline must actually have a date.
  CONSTRAINT confirmed_deadline_has_date
    CHECK (deadline_kind <> 'confirmed' OR deadline IS NOT NULL)
);

CREATE INDEX opportunities_funder_idx ON opportunities (funder_id);
CREATE INDEX opportunities_deadline_idx ON opportunities (deadline);
CREATE INDEX opportunities_freshness_idx ON opportunities (freshness_state);

-- Machine-evaluable criteria. Proposed by extraction, verified by a human, and
-- evaluated by the deterministic engine in src/domain/eligibility.
CREATE TABLE eligibility_criteria (
  id              text PRIMARY KEY,
  opportunity_id  text NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  label           text NOT NULL,
  -- Structured parameters for the criterion, shaped by `kind`.
  params          jsonb NOT NULL,
  cic_handling    cic_treatment,
  verified_by     text,
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX eligibility_criteria_opportunity_idx
  ON eligibility_criteria (opportunity_id);

-- ---------------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id          text PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organisations (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             membership_role NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Tenant-scoped organisation knowledge.
-- ---------------------------------------------------------------------------

CREATE TABLE organisation_profiles (
  id                  text PRIMARY KEY,
  organisation_id     text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  legal_name          text,
  company_number      text,
  form                legal_form,
  incorporation_date  date,
  jurisdiction        jurisdiction,
  region              text,
  annual_turnover_gbp numeric(12,2),
  mission             text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id)
);

CREATE TABLE projects (
  id                  text PRIMARY KEY,
  organisation_id     text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name                text NOT NULL,
  description         text,
  beneficiary_groups  text[] NOT NULL DEFAULT '{}',
  region              text,
  amount_sought_gbp   numeric(12,2),
  duration_months     integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_org_idx ON projects (organisation_id);

-- Facts are append-only. A correction supersedes rather than overwrites, so
-- the record of what the organisation believed, and when, survives.
CREATE TABLE facts (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  claim            text NOT NULL,
  value            text NOT NULL,
  source           source_type NOT NULL,
  source_ref       text,
  source_span      text,
  retrieved_at     timestamptz NOT NULL,
  confidence_level confidence NOT NULL DEFAULT 'medium',
  confirmed_by     text REFERENCES users(id),
  confirmed_at     timestamptz,
  superseded_by    text REFERENCES facts(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- A confirmation must record both who and when.
  CONSTRAINT confirmation_is_complete
    CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL))
);

CREATE INDEX facts_org_claim_idx ON facts (organisation_id, claim);
CREATE INDEX facts_current_idx ON facts (organisation_id) WHERE superseded_by IS NULL;

CREATE TABLE evidence (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  claim            text NOT NULL,
  source_name      text NOT NULL,
  source_url       text,
  published_on     date,
  jurisdiction     jurisdiction,
  region           text,
  population       text,
  review_by        date,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX evidence_org_idx ON evidence (organisation_id);

CREATE TABLE documents (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  filename         text NOT NULL,
  mime_type        text NOT NULL,
  byte_size        bigint NOT NULL,
  storage_key      text NOT NULL,
  classified_as    text,
  uploaded_by      text REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_org_idx ON documents (organisation_id);

CREATE TABLE document_chunks (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  document_id      text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index      integer NOT NULL,
  content          text NOT NULL,
  page_number      integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX document_chunks_org_idx ON document_chunks (organisation_id);

-- ---------------------------------------------------------------------------
-- Applications.
-- ---------------------------------------------------------------------------

CREATE TABLE applications (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  opportunity_id   text REFERENCES opportunities(id),
  project_id       text REFERENCES projects(id),
  status           application_status NOT NULL DEFAULT 'saved',
  amount_requested_gbp numeric(12,2),
  submitted_at     timestamptz,
  outcome_note     text,
  amount_awarded_gbp   numeric(12,2),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX applications_org_idx ON applications (organisation_id);
CREATE INDEX applications_status_idx ON applications (organisation_id, status);

CREATE TABLE application_questions (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  question         text NOT NULL,
  word_limit       integer,
  guidance         text,
  assesses         text,
  UNIQUE (application_id, position)
);

CREATE INDEX application_questions_org_idx ON application_questions (organisation_id);

CREATE TABLE answers (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  question_id      text NOT NULL REFERENCES application_questions(id) ON DELETE CASCADE,
  content          text NOT NULL DEFAULT '',
  word_count       integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id)
);

CREATE INDEX answers_org_idx ON answers (organisation_id);

CREATE TABLE answer_versions (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  answer_id        text NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  content          text NOT NULL,
  created_by       text REFERENCES users(id),
  ai_generation_id text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX answer_versions_org_idx ON answer_versions (organisation_id);

-- Sentence-level provenance: which fact backs which claim in a drafted answer.
CREATE TABLE answer_fact_refs (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  answer_id        text NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  fact_id          text REFERENCES facts(id),
  claim_text       text NOT NULL,
  -- True when the sentence asserts something with no confirmed fact behind it.
  is_unsupported   boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- An unsupported claim has no fact; a supported one must have one.
  CONSTRAINT unsupported_has_no_fact
    CHECK ((fact_id IS NULL) = is_unsupported)
);

CREATE INDEX answer_fact_refs_org_idx ON answer_fact_refs (organisation_id);

CREATE TABLE reviews (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  mode             review_mode NOT NULL,
  findings         jsonb NOT NULL DEFAULT '[]',
  readiness_percent integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT readiness_in_range
    CHECK (readiness_percent IS NULL OR (readiness_percent BETWEEN 0 AND 100))
);

CREATE INDEX reviews_org_idx ON reviews (organisation_id);

CREATE TABLE budgets (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id)
);

CREATE INDEX budgets_org_idx ON budgets (organisation_id);

CREATE TABLE budget_lines (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  budget_id        text NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category         cost_category NOT NULL,
  description      text NOT NULL,
  amount_gbp       numeric(12,2) NOT NULL,
  CONSTRAINT amount_is_positive CHECK (amount_gbp > 0)
);

CREATE INDEX budget_lines_org_idx ON budget_lines (organisation_id);

CREATE TABLE outcomes (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  activity         text NOT NULL,
  output           text NOT NULL,
  outcome          text NOT NULL,
  indicator        text,
  target           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outcomes_org_idx ON outcomes (organisation_id);

-- ---------------------------------------------------------------------------
-- Operational.
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id          text REFERENCES users(id),
  action           text NOT NULL,
  entity_type      text NOT NULL,
  entity_id        text,
  metadata         jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_org_idx ON audit_logs (organisation_id, created_at DESC);

CREATE TABLE ai_generations (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  agent            text NOT NULL,
  prompt_version   text NOT NULL,
  model            text NOT NULL,
  input_tokens     integer,
  output_tokens    integer,
  cost_pence       integer,
  latency_ms       integer,
  schema_valid     boolean NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_generations_org_idx ON ai_generations (organisation_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row-Level Security.
--
-- Every tenant-scoped table gets the same treatment:
--   ENABLE + FORCE so even the table owner is subject to the policy
--   USING      restricts which rows can be read, updated or deleted
--   WITH CHECK stops a tenant writing a row attributed to another tenant
--
-- current_setting(..., true) returns NULL when unset, and `= NULL` is never
-- true, so an unset tenant sees nothing. The system fails closed.
-- ---------------------------------------------------------------------------

CREATE ROLE app_user NOLOGIN;

GRANT SELECT ON source_datasets, funders, funder_awards, opportunities,
  eligibility_criteria TO app_user;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'organisation_profiles', 'projects', 'facts', 'evidence', 'documents',
    'document_chunks', 'applications', 'application_questions', 'answers',
    'answer_versions', 'answer_fact_refs', 'reviews', 'budgets',
    'budget_lines', 'outcomes', 'audit_logs', 'ai_generations'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (organisation_id = current_setting(''app.organisation_id'', true))
         WITH CHECK (organisation_id = current_setting(''app.organisation_id'', true))',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;

-- Organisations and memberships are visible only for the active tenant.
ALTER TABLE organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisations
  USING (id = current_setting('app.organisation_id', true))
  WITH CHECK (id = current_setting('app.organisation_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON organisations TO app_user;

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (organisation_id = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON memberships TO app_user;

GRANT SELECT ON users TO app_user;
