-- Classification labels on a past award.
--
-- 360Giving publishes these as `classifications[].title` — "Children and young
-- people", "Heritage and the arts" — and they are the only field that says
-- what a grant was FOR. `loadAwards` was returning a hard-coded empty array,
-- so the prospect engine's cause matching could never fire against the
-- database: every funder would have looked like they fund nothing in
-- particular.
--
-- Same shape of hole as capital_or_revenue in 0005: the domain logic was
-- capable, the column was missing, and nothing failed loudly.

ALTER TABLE funder_awards ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

-- Prospect research asks "which funders have funded this kind of work", so the
-- lookup is by tag across funders rather than within one.
CREATE INDEX funder_awards_tags_idx ON funder_awards USING gin (tags);
