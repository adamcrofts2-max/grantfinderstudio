-- Grant text search: one full-text index instead of three trigram indexes.
--
-- ## Why this changed
--
-- 0013 indexed grant text with pg_trgm, because the search was `ILIKE '%…%'`
-- on four columns and without trigrams every search was a sequential scan of
-- the whole corpus. It worked. It also cost more room than the data.
--
-- Measured on 20,000 grants in real Postgres, `funder_awards` and its indexes
-- together:
--
--   three GIN trigram indexes   57 MB   (2,978 bytes a grant)
--   one GIN tsvector index      33 MB   (1,737 bytes a grant)
--   no text index at all        31 MB   (1,615 bytes a grant)
--
-- The trigram indexes are 26 MB of the 57. Extrapolated to the quarter of a
-- million grants 360Giving publish, that is the difference between ~680 MB and
-- ~420 MB — and, with the three-year window the ingest now applies, between a
-- corpus that fits a free database tier and one that does not.
--
-- ## What it costs
--
-- Trigrams match any substring; a tsvector matches WORDS. So `somer` no longer
-- finds `Somerset` by accident of spelling — it finds it because the query is
-- built with a prefix (`somer:*`), which is what `buildWhere` does. What is
-- genuinely lost is the middle of a word: `merset` matched before and does not
-- now. Nobody searches that way; everybody searches by prefix and by plural,
-- and stemming makes the plural case BETTER than trigrams ever were —
-- `youth` and `youths` are now the same word rather than two patterns.
--
-- ## Why a stored column and a trigger rather than an expression index
--
-- The vector wants to cover the classification tags too, because a tag
-- ("Young people", "Mental health") is often the only place a grant says what
-- it was FOR. Tags are `text[]`, and turning one into text needs
-- `array_to_string`, which Postgres marks STABLE rather than IMMUTABLE — so it
-- cannot appear in an index expression at all.
--
-- A trigger has a second, better argument in its favour: it cannot be
-- forgotten. Computing the vector in `replaceFunderAwards` would leave every
-- other INSERT — the per-funder admin ingest, every fixture in every test —
-- with a NULL vector and no match, which is precisely the shape of fault this
-- codebase keeps writing down: a test that agrees with the code because both
-- skipped the same step. Rows written by anything at all get a vector here.

ALTER TABLE funder_awards ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Shared by the trigger and the backfill so the indexed text is defined once.
-- STABLE, not IMMUTABLE: that is what `array_to_string` forces, and claiming
-- otherwise to get it into an index expression would be a lie the planner
-- believes.
CREATE OR REPLACE FUNCTION grant_search_vector(
  title text,
  description text,
  recipient_name text,
  region text,
  tags text[]
) RETURNS tsvector
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $fn$
  SELECT to_tsvector('english',
    coalesce(title, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(recipient_name, '') || ' ' ||
    coalesce(region, '') || ' ' ||
    coalesce(array_to_string(tags, ' '), ''));
$fn$;

CREATE OR REPLACE FUNCTION funder_awards_search_vector_set() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $fn$
BEGIN
  NEW.search_vector := grant_search_vector(
    NEW.title, NEW.description, NEW.recipient_name, NEW.region, NEW.tags);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS funder_awards_search_vector_trg ON funder_awards;
CREATE TRIGGER funder_awards_search_vector_trg
  BEFORE INSERT OR UPDATE ON funder_awards
  FOR EACH ROW EXECUTE FUNCTION funder_awards_search_vector_set();

-- Rows already in the table predate the trigger.
UPDATE funder_awards
   SET search_vector =
         grant_search_vector(title, description, recipient_name, region, tags)
 WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS funder_awards_search_idx
  ON funder_awards USING gin (search_vector);

-- The trigram indexes this replaces. Dropped last, so a failure above leaves
-- the corpus with a working index rather than none.
--
-- pg_trgm itself is left installed: dropping an extension another migration or
-- a future index might want is a bigger move than reclaiming three indexes.
DROP INDEX IF EXISTS funder_awards_description_trgm;
DROP INDEX IF EXISTS funder_awards_title_trgm;
DROP INDEX IF EXISTS funder_awards_recipient_trgm;
