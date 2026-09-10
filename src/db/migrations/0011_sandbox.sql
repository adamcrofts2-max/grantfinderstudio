-- An operator's own sandbox.
--
-- ## The problem this solves, and the one it refuses to
--
-- An operator needs to see the product the way a customer sees it. The obvious
-- way to give them that — a console button that opens somebody's account — is
-- the door every leaked support tool has gone through, because it takes WHICH
-- ORGANISATION as an input. Everything dangerous about it lives in that
-- parameter.
--
-- So there is no parameter. A sandbox organisation is derived from the admin's
-- own identity and nothing else: `sandbox_of_admin` records which admin an
-- account belongs to, and the console can only ever resolve the one matching
-- the admin who is signed in. There is no form field, query string or path
-- segment anywhere that names an organisation, so there is nothing to aim.
--
-- What the operator gets is not a special view. It is an ordinary customer
-- session over an ordinary organisation that happens to be theirs — same
-- cookie, same Row-Level Security, same policies, same everything. The console
-- gains no read privilege over tenant data, and `app_operator` still holds no
-- grant on a single tenant table.
--
-- ## Why the flag is on `users` and not on `organisations`
--
-- Because of who has to read it. The console's account list runs through
-- `app_operator`, which is granted SELECT on `users` and on nothing
-- tenant-scoped — so `users` is the only table where a flag can live if the
-- customer counts are going to exclude sandboxes. And the session is already
-- loaded through the owner connection, so the product can carry "this is a
-- sandbox" down from the session it resolves on every request rather than
-- reading a second table for it.
--
-- One column, one reader on each side, no duplicated state.

ALTER TABLE users ADD COLUMN sandbox_of_admin text;

-- One sandbox per admin, enforced here rather than by a check the console
-- performs first: two clicks arriving together would both pass such a check
-- and create two organisations, and the second would be unreachable for ever.
CREATE UNIQUE INDEX users_sandbox_of_admin ON users (sandbox_of_admin)
  WHERE sandbox_of_admin IS NOT NULL;

COMMENT ON COLUMN users.sandbox_of_admin IS
  'Non-null means this is an operator''s own sandbox account, not a customer. '
  'Excluded from every count the console reports. Never set for a real signup.';
