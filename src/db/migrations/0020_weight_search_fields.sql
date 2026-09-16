-- Weight the search fields, so a title counts for more than a recipient's name.
--
-- ## The search this fixes
--
-- Measured against a loaded corpus, "youth skills somerset" returned 61% of
-- the grants held, and the five results shown first were all **Chapel roof
-- repair**. The reason was not the ranking arithmetic but this vector: every
-- field went in with equal weight, so a chapel grant awarded to "Wells Youth
-- Collective" matched `youth` exactly as strongly as a grant titled "Youth
-- skills programme" did.
--
-- A recipient's NAME is not what the money paid for. Half the youth
-- organisations in the country have "youth" in their name, and a grant to one
-- of them for a roof is a roof grant.
--
-- ## The weights, and why
--
--   A  title        the publisher's own summary of what this grant was FOR.
--                   The strongest statement of that anywhere in the record.
--   B  tags         their classification labels — "Children and young people".
--                   Chosen from a list rather than written, so less precise
--                   than a title but more deliberate than prose.
--   C  description  where the detail is, and also where incidental words are:
--                   "we will not be running youth sessions" matches `youth`.
--   D  recipient,   who got it and where. Real signals, weakest evidence of
--      region       what the grant was for.
--
-- Postgres's default weights for {D,C,B,A} are {0.1, 0.2, 0.4, 1.0}, so a
-- title hit is worth ten recipient hits to `ts_rank`. That is the ratio the
-- measurement asked for.
--
-- The region stays in the vector at D rather than coming out: somebody typing
-- "somerset" means it, and the alternative is a search for a place finding
-- nothing. It is simply no longer as loud as the title.

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
  SELECT setweight(to_tsvector('english', coalesce(title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B')
      || setweight(to_tsvector('english', coalesce(description, '')), 'C')
      || setweight(
           to_tsvector('english', coalesce(recipient_name, '') || ' ' || coalesce(region, '')),
           'D');
$fn$;

-- Every row predates the weights. The trigger recomputes on UPDATE, so this
-- rebuilds the lot; `search_vector = NULL` first would leave a window in which
-- the search matched nothing, and one statement does not.
UPDATE funder_awards
   SET search_vector =
         grant_search_vector(title, description, recipient_name, region, tags);
