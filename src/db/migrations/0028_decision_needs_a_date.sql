-- A decided application must carry the date it was decided.
--
-- Separate from 0027 because a new enum value cannot be USED in the same
-- transaction that adds it, and this constraint names all three.
--
-- One-directional on purpose. "decided implies dated" is the invariant worth
-- holding; the converse would forbid a later 'reporting' or 'complete' status
-- on an award that keeps its decision date, and those are real states further
-- down the same lifecycle.
ALTER TABLE applications ADD CONSTRAINT applications_decision_dated CHECK (
  status NOT IN ('awarded', 'rejected', 'no_reply') OR decided_at IS NOT NULL
);
