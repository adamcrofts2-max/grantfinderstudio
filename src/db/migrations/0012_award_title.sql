-- What a grant was actually FOR.
--
-- `funder_awards.description` has existed since 0001 and the demo seed writes
-- it. The real 360Giving ingest never did: `normaliseGrant` reads neither
-- `title` nor `description` from the payload, and the INSERT in `awards.ts`
-- does not list the column. Both fields are declared in `RawGrant`, so the
-- types said they were handled.
--
-- The cost is not cosmetic. A publisher's `title` and `description` are the
-- only free text saying what the money paid for, so a search over awarded
-- grants — the product's central question, "who like us has been funded" —
-- had nothing to match on but a recipient's name. Every text search against
-- real ingested data returned nothing, and looked like a working search.
--
-- `title` is added rather than folded into `description` because 360Giving
-- publishes them as different things: a short label and a longer purpose. A
-- grant list reads as "£24,000 to Wells Youth Collective — Green Skills
-- Programme", which needs the label separate from the prose.

ALTER TABLE funder_awards ADD COLUMN title text;

-- Free-text search across both, which is what the grant search does. A
-- trigram index rather than full-text: publishers write partial words and
-- inconsistent casing, and ILIKE '%skills%' cannot use a tsvector.
--
-- Both the extension and the index are OPTIONAL, and the block below swallows
-- its own failure on purpose. `CREATE EXTENSION IF NOT EXISTS` skips only when
-- the extension is already installed — when it is unavailable it RAISES, which
-- would take the whole migration and therefore the whole deployment with it.
-- PGlite has no pg_trgm at all, and a managed host may restrict extensions.
--
-- Losing the index costs a sequential scan over one table of published data.
-- Losing the deployment costs everything. So the search is correct either way
-- and merely slower without it.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm is unavailable; grant text search will scan instead.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS funder_awards_text_idx ON funder_awards
               USING gin ((coalesce(title, '''') || '' '' ||
                           coalesce(description, '''') || '' '' ||
                           coalesce(recipient_name, '''')) gin_trgm_ops)';
  END IF;
END $$;
