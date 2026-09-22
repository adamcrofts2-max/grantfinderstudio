-- The funder's answer.
--
-- 0001 gave applications 'awarded' and 'rejected' statuses, an
-- amount_awarded_gbp and an outcome_note, and then nothing ever wrote to any
-- of them: the tracker stopped at "submitted" and the product never learned
-- whether a single application had worked. Two things were missing before it
-- could.
--
-- The first is silence. Funders frequently never reply, and a no-reply is not
-- a rejection: the applicant may re-apply, and counting it as a loss would
-- make every success rate we ever show too harsh. It gets its own status
-- rather than being folded into 'rejected'.
--
-- The second is a date. 'awarded' with no date cannot be put on a timeline,
-- cannot be sorted, and cannot answer "how long do these funders take" — which
-- is the question a second application to the same funder needs.
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'no_reply' AFTER 'rejected';

ALTER TABLE applications ADD COLUMN decided_at timestamptz;
