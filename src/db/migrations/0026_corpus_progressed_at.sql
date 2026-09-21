-- When the grant record last actually MOVED, as distinct from when a step was
-- last attempted.
--
-- WHY THESE ARE NOT THE SAME CLOCK
--
-- `updated_at` is set by `claimCorpusStep`, BEFORE the work, deliberately: a
-- step that dies still holds the interval off, so a crash loop cannot become a
-- request loop. That makes it the time of the last ATTEMPT — and since an
-- ordinary page visit claims a step, any traffic at all keeps it fresh whether
-- the load is progressing or not.
--
-- So the only state the product could tell was "started and not finished",
-- which it showed to applicants as "We are building the grant record now …
-- come back in a few minutes and there will be more." A load that can never
-- finish — the API unreachable, every step timing out before it reads a
-- publisher — says that sentence for ever, on the search screen, to everybody.
--
-- This column is written only when a step read a funder or wrote a grant, so
-- "filling" and "stalled" become distinguishable: a recent attempt with no
-- progress behind it is not progress. The console can then say which it is,
-- and name the error, instead of reporting "in progress" indefinitely.
--
-- Nullable with no default, and NOT backfilled to now(): a deployment mid-walk
-- when this migration lands has made progress at some unknown time, and
-- inventing one would be inventing the very fact the column exists to carry.
-- `corpusStanding` reads a null as "no progress recorded yet" and falls back to
-- the attempt clock, which is exactly as much as is known.
ALTER TABLE corpus_load ADD COLUMN progressed_at timestamptz;

COMMENT ON COLUMN corpus_load.progressed_at IS
  'When a step last read a funder or wrote a grant. See updated_at for the last attempt.';
