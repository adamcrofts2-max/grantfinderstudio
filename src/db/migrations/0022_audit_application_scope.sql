-- An audit trail has to be scopeable to one application.
--
-- `audit_logs` has existed since 0001 with no writer at all — the last of the
-- tables 0001 created and nothing filled, after `reviews`, `budgets`,
-- `budget_lines` and `outcomes`. Its columns describe an event
-- (`action`, `entity_type`, `entity_id`) and its owner (`organisation_id`),
-- and that is enough for "what has this organisation done".
--
-- It is not enough for the thing the trail is FOR. Phase 9 Step 2 shares one
-- application read-only with a reviewer the applicant names, and that access
-- is a processor relationship rather than a toggle: it has to be scoped,
-- time-boxed, revocable and audited. A reviewer looking at one application
-- must not be shown the organisation's other applications, so the trail they
-- can see has to be selectable by application — reliably, from a column, not
-- by a convention about what somebody remembered to put in `metadata`.
--
-- NULLABLE, because plenty of what belongs in this trail is not about an
-- application: confirming a fact about the organisation, adding a fund,
-- uploading a document. Those are organisation-level events and carry null.
--
-- ON DELETE CASCADE matches every other reference to `applications` in 0001.
-- The alternative — keeping audit rows for an application that no longer
-- exists — sounds more careful and is not: the rows would name an entity
-- nobody can look up, in a trail whose whole value is that every line can be
-- checked against the thing it describes.
ALTER TABLE audit_logs
  ADD COLUMN application_id text REFERENCES applications(id) ON DELETE CASCADE;

-- The trail is read newest-first, for one organisation, usually for one
-- application. `audit_logs_org_idx` from 0001 already covers the
-- organisation-wide read; this covers the scoped one.
CREATE INDEX audit_logs_application_idx
  ON audit_logs (organisation_id, application_id, created_at DESC);
