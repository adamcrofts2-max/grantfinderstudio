/**
 * Review shares, against the real schema.
 *
 * Phase 9 Step 2: one application, read-only, to a person the applicant names.
 * The roadmap's own bar is that it be scoped, time-boxed, revocable and
 * audited, so those are the four things asserted hardest here.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import {
  createShare,
  loadShares,
  recordShareView,
  resolveShare,
  revokeShare,
} from './shares.js';
import { createShareToken, hashShareToken } from '../auth/token.js';
import { shareExpiry } from '../domain/review/share.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const ORG = 'org_share';
const OTHER_ORG = 'org_share_other';
const APP = 'app_share';
const APP2 = 'app_share_two';
const USER = 'usr_share';
const NOW = new Date('2026-09-21T12:00:00.000Z');

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO organisations (id, name)
      VALUES ('${ORG}', 'Rivermead Trees CIC'), ('${OTHER_ORG}', 'Somebody Else CIC');
    INSERT INTO users (id, email) VALUES ('${USER}', 'me@example.org');
    INSERT INTO applications (id, organisation_id, status)
      VALUES ('${APP}', '${ORG}', 'drafting'), ('${APP2}', '${ORG}', 'drafting');
  `);
});

afterEach(async () => {
  await harness.close();
});

const make = async (over: Partial<{ applicationId: string; reviewerName: string; days: number }> = {}) => {
  const token = createShareToken();
  const share = await createShare(tx(), ORG, {
    applicationId: over.applicationId ?? APP,
    reviewerName: over.reviewerName ?? 'Jan, our treasurer',
    tokenHash: hashShareToken(token),
    expiresAt: shareExpiry(NOW, over.days ?? 14),
    createdBy: USER,
  });
  return { token, share };
};

describe('making a share', () => {
  it('returns the row, and the token is the caller’s to keep', async () => {
    const { token, share } = await make();
    expect(share.reviewerName).toBe('Jan, our treasurer');
    expect(share.applicationId).toBe(APP);
    expect(share.views).toBe(0);
    expect(share.revokedAt).toBeNull();
    expect(token.length).toBeGreaterThan(20);
  });

  /**
   * THE TOKEN IS NOT IN THE TABLE.
   *
   * Only its SHA-256, exactly as `sessions` stores a session. A copy of this
   * table is not a set of working links — there is nothing in it to replay.
   */
  it('stores no token, only its hash', async () => {
    const { token } = await make();
    const { rows } = await harness.db.query(
      `SELECT * FROM application_shares`,
    ) as { rows: Record<string, unknown>[] };
    const dumped = JSON.stringify(rows);
    expect(dumped).not.toContain(token);
    expect(dumped).toContain(hashShareToken(token));
  });

  it('emits timestamps `new Date()` accepts', async () => {
    const { share } = await make();
    for (const value of [share.createdAt, share.expiresAt]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
      expect(Number.isNaN(new Date(value).getTime())).toBe(false);
    }
  });

  it('refuses a share with nobody named', async () => {
    // The label is how an applicant tells their own shares apart and knows
    // whose access they are withdrawing. A blank one is a row nobody can act
    // on, refused by the table rather than by whichever screen remembers.
    await expect(make({ reviewerName: '   ' })).rejects.toThrow();
  });
});

describe('a reviewer arriving with a link', () => {
  it('resolves to the organisation and the one application it names', async () => {
    const { token } = await make();
    const resolved = await resolveShare(tx(), token, NOW);
    expect(resolved?.organisationId).toBe(ORG);
    expect(resolved?.applicationId).toBe(APP);
    expect(resolved?.standing).toBe('live');
    expect(resolved?.reviewerName).toBe('Jan, our treasurer');
  });

  it('resolves to nothing for a token nobody issued', async () => {
    expect(await resolveShare(tx(), createShareToken(), NOW)).toBeNull();
    expect(await resolveShare(tx(), '', NOW)).toBeNull();
    expect(await resolveShare(tx(), '   ', NOW)).toBeNull();
  });

  it('says WHICH refusal it is, rather than just failing', async () => {
    // Withdrawn and expired are different facts, and the applicant's own
    // record of what they did. A reviewer told only "no" emails the wrong
    // person.
    const { token: expiredToken } = await make({ days: 7 });
    const later = new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000);
    expect((await resolveShare(tx(), expiredToken, later))?.standing).toBe('expired');

    const { token: liveToken, share } = await make();
    expect(await revokeShare(tx(), APP, share.id)).toBe(true);
    expect((await resolveShare(tx(), liveToken, NOW))?.standing).toBe('revoked');
  });

  it('records both ends of the reading, and a count', async () => {
    const { token, share } = await make();
    await recordShareView(tx(), share.id);
    const [once] = await loadShares(tx(), APP);
    expect(once?.views).toBe(1);
    expect(once?.firstViewedAt).not.toBeNull();

    await recordShareView(tx(), share.id);
    const [twice] = await loadShares(tx(), APP);
    expect(twice?.views).toBe(2);
    // The first reading never moves: "opened once, three weeks ago" and
    // "opened eleven times, last night" are different facts.
    expect(twice?.firstViewedAt).toBe(once?.firstViewedAt);
    expect(await resolveShare(tx(), token, NOW)).not.toBeNull();
  });

  it('reports the PREVIOUS read, which the write itself destroys', async () => {
    const { share } = await make();
    // Nothing before the first one, which is what makes it a first visit.
    const first = await recordShareView(tx(), share.id);
    expect(first.views).toBe(1);
    expect(first.previousViewAt).toBeNull();

    const second = await recordShareView(tx(), share.id);
    expect(second.views).toBe(2);
    // The time of the FIRST read, not of this one — `RETURNING` would have
    // given the value this statement had just overwritten.
    expect(second.previousViewAt).not.toBeNull();
    expect(Date.parse(second.previousViewAt ?? '')).not.toBeNaN();
    const [row] = await loadShares(tx(), APP);
    expect(second.previousViewAt).toBe(row?.firstViewedAt);
  });

  it('does not fail a reviewer’s page over a share that has gone', async () => {
    const visit = await recordShareView(tx(), 'shr_never_existed');
    expect(visit).toEqual({ views: 0, previousViewAt: null });
  });
});

describe('withdrawing a share', () => {
  it('stops the link and keeps the row', async () => {
    const { token, share } = await make();
    await recordShareView(tx(), share.id);
    expect(await revokeShare(tx(), APP, share.id)).toBe(true);
    expect((await resolveShare(tx(), token, NOW))?.standing).toBe('revoked');
    // The row survives because it is the applicant's record of who saw what.
    const [kept] = await loadShares(tx(), APP);
    expect(kept?.revokedAt).not.toBeNull();
    expect(kept?.views).toBe(1);
  });

  it('keeps the first withdrawal, which is when access actually stopped', async () => {
    const { share } = await make();
    expect(await revokeShare(tx(), APP, share.id)).toBe(true);
    const [first] = await loadShares(tx(), APP);
    expect(await revokeShare(tx(), APP, share.id)).toBe(false);
    const [again] = await loadShares(tx(), APP);
    expect(again?.revokedAt).toBe(first?.revokedAt);
  });

  it('cannot be reached with an id from another application', async () => {
    // The reason `budget.ts` scopes its delete the same way: an id from one
    // application must not act on another's row, even inside one organisation.
    const { share } = await make();
    expect(await revokeShare(tx(), APP2, share.id)).toBe(false);
    expect((await loadShares(tx(), APP))[0]?.revokedAt).toBeNull();
  });
});

describe('the applicant’s own list', () => {
  it('is scoped to one application', async () => {
    await make({ reviewerName: 'Jan' });
    await make({ applicationId: APP2, reviewerName: 'Sam' });
    expect((await loadShares(tx(), APP)).map((s) => s.reviewerName)).toEqual(['Jan']);
    expect((await loadShares(tx(), APP2)).map((s) => s.reviewerName)).toEqual(['Sam']);
  });

  it('is newest first', async () => {
    await make({ reviewerName: 'First' });
    await make({ reviewerName: 'Second' });
    const names = (await loadShares(tx(), APP)).map((s) => s.reviewerName);
    expect(names).toHaveLength(2);
    expect(names).toContain('First');
    expect(names).toContain('Second');
  });
});
