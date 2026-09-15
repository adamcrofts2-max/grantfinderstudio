-- Funders the walk could not read at all.
--
-- The third case of the same fault, and the last one open. A licence skip is
-- counted (0013). A record cut short by the page cap is counted (0014), after
-- it spent a session producing wrong medians in silence. A funder whose fetch
-- THROWS was counted nowhere: it wrote `last_error`, one slot that the next
-- successful step overwrites.
--
-- Found by walking the product. Three publishers failed mid-walk — the three
-- largest in the list, about 900 grants between them — and the console then
-- reported "Funders read 42 of 42 — 100%", "Records cut short 0", state
-- "finished", and no problem at all. A walk can lose its biggest publishers
-- and look complete.
--
-- `failed_org_ids` as well as a count, because a number tells an operator
-- that something is wrong and the ids tell them what to re-fetch. Bounded to
-- the most recent few dozen in `recordCorpusStep`: this is a diagnostic, not
-- a queue, and an unbounded array on a row everybody reads is its own fault.
ALTER TABLE corpus_load
  ADD COLUMN IF NOT EXISTS funders_failed integer NOT NULL DEFAULT 0;

ALTER TABLE corpus_load
  ADD COLUMN IF NOT EXISTS failed_org_ids text[] NOT NULL DEFAULT '{}';
