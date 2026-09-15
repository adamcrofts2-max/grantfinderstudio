-- Bring what is already stored into line with the window the product states.
--
-- 0016 put a three-year window on the INGEST. It says nothing about grants
-- already in the table: the sixteen funders walked before this shipped had
-- their whole published history stored, back to 2015. So `/grants` would have
-- read "From the last 3 years of published grants" over a list containing a
-- grant from 2015 — the exact shape of fault the window's own tests are there
-- to prevent, a screen contradicting the data under it.
--
-- Deleting stored rows in a migration deserves a sentence of justification.
-- These are derived, re-fetchable open data: every one of them came from
-- `org/{id}/grants_made/` and comes back on the next walk if the window ever
-- changes. Nothing anybody typed is touched — no organisation, no fund, no
-- application, no fact. `funder_awards` is the cache, not the record.
--
-- A grant with no award date is KEPT. A missing field is not evidence of age,
-- and discarding data because a publisher left a column out is how a corpus
-- quietly loses the rows nobody can explain later.
--
-- This is a one-off tidy, not a maintenance mechanism: rows drift out of the
-- window as time passes and are only removed when their funder is next
-- walked. The rolling re-read on the roadmap is what keeps it true.
DELETE FROM funder_awards
 WHERE awarded_on IS NOT NULL
   AND awarded_on < (now() - interval '3 years')::date;
