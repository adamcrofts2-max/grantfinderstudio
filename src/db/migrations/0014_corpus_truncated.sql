-- How many funders' records we know to be INCOMPLETE.
--
-- `maxPages` capped each funder at 20 pages — 2,000 grants — and the
-- connector's `truncated` flag was returned and then dropped on the floor. So
-- a funder who has published more than that had their record silently cut
-- short, and every figure computed from it was wrong: the median, the
-- quartiles, "6 grants like yours", the range. Wrong quietly, which is the
-- only kind that matters.
--
-- The big UK funders publish tens of thousands of grants, so this was not an
-- edge case; it was the most important funders in the corpus.
--
-- Counted rather than merely fixed, because a cap still exists — it has to,
-- or one enormous publisher eats a whole step — and a cap nobody can see is
-- how this happened in the first place.
ALTER TABLE corpus_load
  ADD COLUMN IF NOT EXISTS funders_truncated integer NOT NULL DEFAULT 0;
