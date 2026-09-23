/**
 * Handing an organisation everything this product holds about it. TENANT path.
 *
 * ## Driven from the privacy record, not from a list kept here
 *
 * A hand-written export forgets the table somebody added last month, and a
 * person who asks for their data and receives most of it has been told
 * something untrue. So the tables come from `PRIVACY_RECORD`, which a database
 * test already holds to the live schema: a table that exists and is not in the
 * record fails the build, and once it is in the record it is in the export.
 *
 * ## Why SELECT * is right here and almost nowhere else
 *
 * Every other read in this codebase names its columns, because a read model
 * should not change shape when a migration lands. This one should. The
 * question it answers is "what do you have about me", and a column added next
 * year is part of that answer whether or not anybody remembered this file.
 *
 * Row-level security does the scoping: the tenant connection can only see its
 * own rows, so there is no WHERE clause here to forget.
 */

import {
  PRIVACY_RECORD,
  YOURS_IN_SHARED_TABLES,
  type Held,
  type OwnedRows,
} from '../domain/privacy/record.js';
import type { Queryable } from './client.js';

/** Tables whose rows belong to the organisation and go in the export. */
function exportable(): readonly Held[] {
  return PRIVACY_RECORD.filter((held) => held.subject === 'organisation');
}

/**
 * A table name is interpolated below, so it is checked first.
 *
 * The names come from a constant in this repository and not from anything a
 * user typed, which makes this belt and braces — and belt and braces is the
 * correct amount of care for the one place in the codebase that builds SQL by
 * concatenation.
 */
const SAFE_NAME = /^[a-z_]+$/u;

export interface ExportedMember {
  email: string;
  name: string | null;
  role: string;
  joined: string;
}

export interface OrganisationExport {
  /** ISO timestamp the export was taken. */
  takenAt: string;
  organisationId: string;
  /** One entry per table, keyed by the table name, each an array of rows. */
  data: Record<string, unknown[]>;
  /** The people in the organisation: address and name, never a password. */
  members: ExportedMember[];
  /** What each table is, so the file is readable without the schema. */
  legend: Record<string, { label: string; holds: string }>;
}

/** Who is in the organisation, as the tenant connection can see it. */
export interface MemberSeat {
  userId: string;
  role: string;
  joined: string;
}

/**
 * The membership rows, without the people.
 *
 * Split from the addresses on purpose. 0009 revoked the tenant role's SELECT
 * on `users` because that table holds the whole platform's customer list and
 * nothing on the tenant path needed it — so the seats are read here, the
 * addresses are read by `namesFor` on the operator connection, and the two are
 * joined in memory by whoever is composing the export. Widening the grant to
 * save a join would undo a deliberate piece of the isolation.
 */
export async function seatsIn(tx: Queryable): Promise<MemberSeat[]> {
  const { rows } = await tx.query<{ user_id: string; role: string; joined: string }>(
    `SELECT user_id, role::text AS role,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS joined
       FROM memberships ORDER BY created_at`,
  );
  return rows.map((r) => ({ userId: r.user_id, role: r.role, joined: r.joined }));
}

/** The addresses behind those seats. OPERATOR path — see `seatsIn`. */
export async function namesFor(
  tx: Queryable,
  userIds: readonly string[],
): Promise<Map<string, { email: string; name: string | null }>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await tx.query<{ id: string; email: string; name: string | null }>(
    'SELECT id, email, name FROM users WHERE id = ANY($1::text[])',
    [[...userIds]],
  );
  return new Map(rows.map((r) => [r.id, { email: r.email, name: r.name }]));
}

/** Put the two halves together. Pure, so the joining is testable on its own. */
export function withMembers(
  dump: Omit<OrganisationExport, 'members'>,
  seats: readonly MemberSeat[],
  names: Map<string, { email: string; name: string | null }>,
): OrganisationExport {
  return {
    ...dump,
    members: seats.map((seat) => ({
      email: names.get(seat.userId)?.email ?? '(address no longer held)',
      name: names.get(seat.userId)?.name ?? null,
      role: seat.role,
      joined: seat.joined,
    })),
  };
}

export async function exportOrganisation(
  tx: Queryable,
  organisationId: string,
): Promise<Omit<OrganisationExport, 'members'>> {
  const data: Record<string, unknown[]> = {};
  const legend: Record<string, { label: string; holds: string }> = {};

  for (const held of exportable()) {
    if (!SAFE_NAME.test(held.table)) {
      throw new Error(`Refusing to export a table with an unexpected name: ${held.table}`);
    }
    const { rows } = await tx.query(`SELECT * FROM ${held.table}`);
    data[held.table] = rows;
    legend[held.table] = { label: held.label, holds: held.holds };
  }

  // Your rows inside the shared tables. Filtered by the owning column rather
  // than left to row-level security, because RLS on these tables shows the
  // shared rows too — and an export of every 360Giving funder is not "what
  // you hold about me".
  for (const owned of YOURS_IN_SHARED_TABLES) {
    const rows = await ownedRows(tx, owned, organisationId);
    data[owned.table] = rows;
    legend[owned.table] = { label: owned.label, holds: owned.holds };
  }

  return { takenAt: new Date().toISOString(), organisationId, data, legend };
}

/** The rows of a shared table that belong to one organisation. */
async function ownedRows(
  tx: Queryable,
  owned: OwnedRows,
  organisationId: string,
): Promise<unknown[]> {
  for (const name of [owned.table, owned.owner, owned.via?.parent, owned.via?.key]) {
    if (name !== undefined && !SAFE_NAME.test(name)) {
      throw new Error(`Refusing to export with an unexpected name: ${name}`);
    }
  }
  const sql =
    owned.via === undefined
      ? `SELECT * FROM ${owned.table} WHERE ${owned.owner} = $1`
      : `SELECT c.* FROM ${owned.table} c
           JOIN ${owned.via.parent} p ON p.id = c.${owned.via.key}
          WHERE p.${owned.owner} = $1`;
  const { rows } = await tx.query(sql, [organisationId]);
  return rows;
}

/**
 * How many rows there are of each thing, without reading any of them.
 *
 * Shown before an irreversible delete. "This will remove 3 applications, 41
 * answers and 2 documents" is a different decision from "delete everything?",
 * and it is the only way somebody can tell they are about to erase the right
 * account.
 */
export async function countEverything(
  tx: Queryable,
  organisationId?: string,
): Promise<Array<{ label: string; rows: number }>> {
  const counts: Array<{ label: string; rows: number }> = [];
  for (const held of exportable()) {
    if (!SAFE_NAME.test(held.table)) continue;
    const { rows } = await tx.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${held.table}`);
    const n = Number(rows[0]?.n ?? '0');
    // `counted`, not `label`: this feeds a sentence, and "3 your applications"
    // is not one.
    if (n > 0) counts.push({ label: held.counted, rows: n });
  }
  // What a delete takes from the shared tables, too. Left out, the sentence
  // understates the erasure by exactly the research somebody most wanted gone.
  if (organisationId !== undefined) {
    for (const owned of YOURS_IN_SHARED_TABLES) {
      const n = (await ownedRows(tx, owned, organisationId)).length;
      if (n > 0) counts.push({ label: owned.counted, rows: n });
    }
  }
  return counts;
}
