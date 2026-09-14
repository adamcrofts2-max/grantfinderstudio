-- Progress of assembling the local grant corpus from 360Giving.
--
-- One row, id = 'corpus'. A single-row table rather than a column somewhere
-- because this is platform state, owned by no tenant, and it has to survive a
-- request ending: the load cannot happen in one HTTP request. There are
-- thousands of funders, 360Giving allow 100 funder-list requests a minute and
-- 1000 grant requests a minute, and a serverless function is killed long before
-- that finishes. So the load is a sequence of bounded steps, each of which
-- reads where the last one got to and writes where it reached.
--
-- Restartable rather than resumable-once: a step that dies leaves `cursor`
-- where it was, and the next step redoes that funder. Re-ingesting one funder
-- replaces its awards, so doing it twice is not doing it wrong.

CREATE TABLE IF NOT EXISTS corpus_load (
  id                text        PRIMARY KEY,
  -- Offset into org/funder/, which is the list being walked.
  cursor            integer     NOT NULL DEFAULT 0,
  -- What the API said the list length is, when it last said.
  funders_total     integer,
  funders_done      integer     NOT NULL DEFAULT 0,
  awards_written    integer     NOT NULL DEFAULT 0,
  -- Funders skipped because their grants stated no licence. Counted rather
  -- than hidden: refusing unlicensed data is a rule, and a rule that silently
  -- drops a tenth of the corpus is one somebody needs to be able to see.
  funders_unlicensed integer    NOT NULL DEFAULT 0,
  started_at        timestamptz,
  updated_at        timestamptz,
  finished_at       timestamptz,
  -- The last failure, kept so a stalled load can say why rather than looking
  -- like a load that is merely slow.
  last_error        text,
  last_org_id       text
);

-- Readable by every tenant, writable by nobody but the owner. The same rule
-- the rest of the shared reference data follows: a CIC may see how much of the
-- corpus is loaded, because that is what explains an empty search.
GRANT SELECT ON corpus_load TO app_user;
GRANT SELECT ON corpus_load TO app_operator;

-- Searching grant text means matching against description, title, recipient
-- and region, and every one of those is an ILIKE '%...%'. Without trigram
-- indexes that is a sequential scan of the whole corpus per term.
--
-- Wrapped, because pg_trgm is an extension and a managed host may not offer
-- it — and PGlite, which the tests run on, does not. A missing index makes the
-- search slow; a failed migration makes the product not start.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS funder_awards_description_trgm
    ON funder_awards USING gin (description gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS funder_awards_title_trgm
    ON funder_awards USING gin (title gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS funder_awards_recipient_trgm
    ON funder_awards USING gin (recipient_name gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable; grant search will scan rather than seek (%)', SQLERRM;
END $$;
