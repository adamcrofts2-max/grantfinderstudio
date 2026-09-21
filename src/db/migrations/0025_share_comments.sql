-- What a reviewer says about one answer.
--
-- Phase 9 Step 2's third bullet. The share (0023) gave a named outsider a
-- read; this gives them somewhere to put what they noticed, attached to the
-- answer it is about — because "the second answer does not say who benefits"
-- is actionable and the same sentence at the foot of six answers is a puzzle.
--
-- WHY `question_id` MAY BE NULL
--
-- "The budget does not match what answer 3 promises" belongs to the
-- application rather than to one box. Forcing it onto an arbitrary question
-- would file it where nobody would look for it.
--
-- WHY IT CASCADES WITH THE QUESTION RATHER THAN OUTLIVING IT
--
-- A comment is about the words in one answer. If the applicant deletes the
-- question, those words are gone and the note is advice about nothing — a
-- line the applicant then has to clear to get their screen back. Deleting a
-- question is a deliberate act, and taking its comments with it is the
-- reading that leaves no litter. (`ON DELETE SET NULL` was the alternative
-- and is worse: it silently reclassifies a specific note as a general one.)
--
-- WHY THE BODY IS BOUNDED IN THE COLUMN
--
-- `checkComment` bounds it too, and belt-and-braces is the rule for anything
-- a bearer token can write: the length limit is part of what makes a leaked
-- link a nuisance rather than a way to fill somebody's application with a
-- pasted document. The row cap (50 per share) lives in the domain, because it
-- is a count across rows rather than a fact about one.
--
-- THE TEXT IS UNTRUSTED. It comes from outside the organisation and outside
-- any account. It is escaped on the way to a screen by React and never
-- spliced into a model prompt.
CREATE TABLE share_comments (
  id               text PRIMARY KEY,
  organisation_id  text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  application_id   text NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  -- Which link it came through, so one reviewer is never shown another's
  -- notes, and so a withdrawn link's comments stay attributable.
  share_id         text NOT NULL REFERENCES application_shares(id) ON DELETE CASCADE,
  question_id      text REFERENCES application_questions(id) ON DELETE CASCADE,
  body             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- The applicant's side of it: a comment they have dealt with stops being a
  -- thing to do without being deleted, because what a reviewer said is worth
  -- keeping even once it is answered.
  handled_at       timestamptz,
  handled_by       text REFERENCES users(id),
  CONSTRAINT share_comments_body_present CHECK (btrim(body) <> ''),
  CONSTRAINT share_comments_body_bounded CHECK (length(body) <= 2000),
  CONSTRAINT share_comments_handled_together
    CHECK ((handled_at IS NULL) = (handled_by IS NULL))
);

-- The applicant's list, and the count beside a question.
CREATE INDEX share_comments_application_idx
  ON share_comments (organisation_id, application_id, created_at DESC);
-- The reviewer's own list, and the per-share cap.
CREATE INDEX share_comments_share_idx ON share_comments (share_id);

-- Tenant-scoped in the same form as everything else holding an
-- organisation's work. The reviewer writes through the TENANT connection with
-- the organisation their token named, so this one policy covers both sides
-- and 0024's token policy has no equivalent here — nothing reads this table
-- without a tenant context.
ALTER TABLE share_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON share_comments
  USING (organisation_id = current_setting('app.organisation_id', true))
  WITH CHECK (organisation_id = current_setting('app.organisation_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON share_comments TO app_user;

-- The operator reads the platform's own tables and never a tenant's. A new
-- tenant table has to be added to that refusal explicitly — asserted table by
-- table in `src/db/operator-scope.test.ts`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_operator') THEN
    EXECUTE 'REVOKE ALL ON share_comments FROM app_operator';
  END IF;
END $$;
