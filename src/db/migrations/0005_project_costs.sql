-- Whether a project is capital or revenue spend.
--
-- `capital_revenue` is one of the ten criteria the eligibility engine can
-- evaluate, and `loadProject` was returning a hard-coded null for it — so a
-- funder that only funds capital works could never be matched against a
-- project, and the criterion silently evaluated as unknown for everyone.
--
-- 'both' exists because plenty of projects genuinely are, and forcing a choice
-- would make the applicant guess.

CREATE TYPE project_spend AS ENUM ('capital', 'revenue', 'both');

ALTER TABLE projects ADD COLUMN capital_or_revenue project_spend;
