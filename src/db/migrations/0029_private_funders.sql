-- A funder somebody typed in is private to them.
--
-- Found by the September 2026 security review. 0004 made a pasted FUND
-- private — "doing it with a blanket GRANT would leak one CIC's research,
-- which funds they are chasing" — and then closed with:
--
--   "Funders remain shared and read-only to tenants: a pasted opportunity
--    reuses an existing funder where the name matches, and creating a new
--    funder row is the platform's job."
--
-- That left the funder's NAME, which is the relationship itself, in a shared
-- table. `/funders` lists every row of it, a funder with no awards is tiered
-- 'not_characterised', and that tier renders — so a family trust one CIC had
-- typed in appeared on every other CIC's funder list. And reuse by name meant
-- the next organisation to type the same words got the first one's row.
--
-- The fix is 0004's, applied one table along: a column saying whose it is,
-- and a read policy that shows shared rows to everybody and private rows only
-- to their owner. ENABLE without FORCE for exactly the reason 0004 gives —
-- the owner is the publisher of shared data, and migrations, ingestion and the
-- add-a-fund path all write as the owner. The tenant role has no write grant
-- on this table and gets none here.

ALTER TABLE funders
  ADD COLUMN added_by_organisation_id text REFERENCES organisations(id) ON DELETE CASCADE;

-- Rows already typed in carry the organisation in their id, in one of two
-- shapes, because two different forms created them:
--
--   funder_user_<organisation id>_<base36 time>            pasted guidance
--   funder_typed_<organisation id>_<base36 time>_<random>  typed by hand
--
-- The organisation id can itself contain underscores, so it is taken as
-- everything between the prefix and the trailing segments. Only claimed where
-- that organisation still exists, so a row whose owner is gone is not
-- attributed to a string that means nothing.
UPDATE funders f
   SET added_by_organisation_id = o.id
  FROM organisations o
 WHERE f.id LIKE 'funder\_user\_%' ESCAPE '\'
   AND o.id = regexp_replace(f.id, '^funder_user_(.*)_[^_]+$', '\1');

UPDATE funders f
   SET added_by_organisation_id = o.id
  FROM organisations o
 WHERE f.id LIKE 'funder\_typed\_%' ESCAPE '\'
   AND o.id = regexp_replace(f.id, '^funder_typed_(.*)_[^_]+_[^_]+$', '\1');

CREATE INDEX funders_added_by_idx ON funders (added_by_organisation_id)
  WHERE added_by_organisation_id IS NOT NULL;

ALTER TABLE funders ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_or_own_read ON funders
  FOR SELECT
  USING (
    added_by_organisation_id IS NULL
    OR added_by_organisation_id = current_setting('app.organisation_id', true)
  );
