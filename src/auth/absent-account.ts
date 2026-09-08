/**
 * The hash checked against when no account exists.
 *
 * Without it, "no such account" returns in a millisecond and "wrong password"
 * takes as long as scrypt does — and the difference tells anyone timing the
 * responses which addresses are registered. The work has to be done either
 * way, so it is done against this.
 *
 * It is a REAL hash of a passphrase nobody holds, at current parameters. That
 * matters: a malformed one would be rejected by `verifyPassword` before it did
 * any work, which is the failure this constant exists to prevent, and it would
 * look identical from the outside. There is a test.
 */
export const ABSENT_ACCOUNT_HASH =
  'scrypt$65536$8$1$5TlutrOMuZ2naaUXKDNzIA$4sEGjWlCbAsi55dCsXVL3YiWGQDYyv1mlmI44iiExEKfKiHs_DDymLtyFrRT8hkOFsRGIMytJyHnKxDSaxJEzA';
