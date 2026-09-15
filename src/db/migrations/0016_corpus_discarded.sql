-- Grants the ingest fetched and did not keep, because of the recency window.
--
-- The ingest holds the last three years (`RECENT_YEARS`), which is what makes
-- the corpus fit a free database tier. Everything older is fetched — 360Giving
-- publish no date filter on any grant route, so there is no way to not fetch
-- it — read, and dropped.
--
-- Counted for the same reason `funders_truncated` is counted in 0014: a cap
-- that quietly removes part of the corpus is a cap nobody can audit, and the
-- last one cost a session's worth of wrong medians before anybody saw it. A
-- cap still has to exist. What must never happen again is that it is invisible.
ALTER TABLE corpus_load
  ADD COLUMN IF NOT EXISTS awards_discarded integer NOT NULL DEFAULT 0;
