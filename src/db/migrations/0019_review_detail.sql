-- The rest of a review, so one can be read back.
--
-- `reviews` has carried `findings` and `readiness_percent` since 0001 and
-- nothing ever wrote to it: a review lived in `useActionState` and was gone
-- the moment somebody navigated away. Each one costs a model call, so the
-- product was charging for work it then discarded — and an applicant who
-- wanted to act on a finding had to pay for the review twice.
--
-- The columns below are the parts of a review 0001 did not anticipate,
-- because the Critic did not return them yet. Added rather than folded into
-- `findings`, which means findings: a column whose name stops describing its
-- contents is how a schema becomes a thing you have to ask somebody about.
--
--   summary         the one line the panel leads with
--   most_important  the finding the Critic would fix first, if it named one
--   strengths       what it found working, so a review is not only a list of
--                   faults — an applicant who is told only what is wrong
--                   rewrites the parts that were fine
--   injected        passages in the application that tried to instruct the
--                   reviewer. Recorded because somebody should know they are
--                   in there, and because a pasted funder document is the
--                   likeliest way they got there
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS summary        text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS most_important text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS strengths      jsonb NOT NULL DEFAULT '[]';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS injected       jsonb NOT NULL DEFAULT '[]';

-- Read back newest-first for one application, which is the only way anything
-- reads this table.
CREATE INDEX IF NOT EXISTS reviews_application_idx
  ON reviews (application_id, created_at DESC);
