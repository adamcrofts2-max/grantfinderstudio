/**
 * Reviewer comments, against the real schema.
 *
 * The properties asserted hardest are the two that make a bearer token safe
 * to hand out: a comment is attributed by the SHARE that authenticated it,
 * and it cannot be filed against another application's question.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import {
  addComment,
  countCommentsForShare,
  loadComments,
  questionNumber,
  setCommentHandled,
} from './comments.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const ORG = 'org_cmt';
const APP = 'app_cmt';
const OTHER_APP = 'app_cmt_other';
const SHARE = 'shr_cmt';
const OTHER_SHARE = 'shr_cmt_two';
const Q1 = 'q_cmt_1';
const OTHER_Q = 'q_cmt_other';
const USER = 'usr_cmt';

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO organisations (id, name) VALUES ('${ORG}', 'Rivermead Trees CIC');
    INSERT INTO users (id, email) VALUES ('${USER}', 'me@example.org');
    INSERT INTO applications (id, organisation_id, status) VALUES
      ('${APP}', '${ORG}', 'drafting'),
      ('${OTHER_APP}', '${ORG}', 'drafting');
    INSERT INTO application_questions
      (id, organisation_id, application_id, position, question) VALUES
      ('${Q1}', '${ORG}', '${APP}', 1, 'Tell us about your organisation.'),
      ('${OTHER_Q}', '${ORG}', '${OTHER_APP}', 1, 'A question on the other one.');
    INSERT INTO application_shares
      (id, organisation_id, application_id, token_hash, reviewer_name, expires_at) VALUES
      ('${SHARE}', '${ORG}', '${APP}', 'hash_cmt_1', 'Jan, our treasurer',
       now() + interval '14 days'),
      ('${OTHER_SHARE}', '${ORG}', '${APP}', 'hash_cmt_2', 'Priya, a trustee',
       now() + interval '14 days');
  `);
});

afterEach(async () => {
  await harness.close();
});

const leave = (body: string, over: { questionId?: string | null; shareId?: string } = {}) =>
  addComment(tx(), ORG, {
    applicationId: APP,
    shareId: over.shareId ?? SHARE,
    questionId: over.questionId === undefined ? Q1 : over.questionId,
    body,
  });

describe('leaving a comment', () => {
  it('returns it with the reviewer’s name from the share', async () => {
    // Not from the form. The share is what authenticated them.
    const comment = await leave('No numbers in this answer.');
    expect(comment?.body).toBe('No numbers in this answer.');
    expect(comment?.reviewerName).toBe('Jan, our treasurer');
    expect(comment?.questionId).toBe(Q1);
    expect(comment?.handledAt).toBeNull();
  });

  it('allows a comment about the application as a whole', async () => {
    const comment = await leave('The budget does not match answer 3.', { questionId: null });
    expect(comment?.questionId).toBeNull();
  });

  it('refuses a question belonging to another application', async () => {
    // RLS keeps this inside the organisation; this keeps it inside the
    // application, which RLS cannot do.
    expect(await leave('Filed in the wrong place.', { questionId: OTHER_Q })).toBeNull();
    expect(await loadComments(tx(), APP)).toHaveLength(0);
  });

  it('refuses a question that does not exist', async () => {
    expect(await leave('About nothing.', { questionId: 'q_never' })).toBeNull();
  });

  it('emits a timestamp `new Date()` accepts', async () => {
    const comment = await leave('A note.');
    expect(Number.isNaN(Date.parse(comment?.createdAt ?? ''))).toBe(false);
  });

  it('refuses an empty body at the column', async () => {
    // `checkComment` refuses it first; the constraint is the belt to that
    // braces, because a bearer token is writing.
    await expect(leave('   ')).rejects.toThrow(/share_comments_body_present/u);
  });

  it('refuses a pasted document at the column', async () => {
    await expect(leave('x'.repeat(2_001))).rejects.toThrow(/share_comments_body_bounded/u);
  });
});

describe('counting what one link has left', () => {
  it('counts only that link’s own comments', async () => {
    await leave('One.');
    await leave('Two.');
    await leave('From the other reviewer.', { shareId: OTHER_SHARE });
    expect(await countCommentsForShare(tx(), SHARE)).toBe(2);
    expect(await countCommentsForShare(tx(), OTHER_SHARE)).toBe(1);
  });

  it('is zero for a link that has left none', async () => {
    expect(await countCommentsForShare(tx(), SHARE)).toBe(0);
  });
});

describe('reading them back', () => {
  it('is oldest first, because a review is a sequence', async () => {
    await leave('First point.');
    await leave('Second point.');
    await leave('Third point.');
    const all = await loadComments(tx(), APP);
    expect(all.map((c) => c.body)).toEqual(['First point.', 'Second point.', 'Third point.']);
  });

  it('shows one reviewer only their own notes', async () => {
    await leave('Mine.');
    await leave('Theirs.', { shareId: OTHER_SHARE });
    const mine = await loadComments(tx(), APP, { shareId: SHARE });
    expect(mine.map((c) => c.body)).toEqual(['Mine.']);
  });

  it('shows the applicant everything on their application', async () => {
    await leave('Mine.');
    await leave('Theirs.', { shareId: OTHER_SHARE });
    expect(await loadComments(tx(), APP)).toHaveLength(2);
  });

  it('is scoped to one application', async () => {
    await leave('About this one.');
    expect(await loadComments(tx(), OTHER_APP)).toHaveLength(0);
  });
});

describe('dealing with one', () => {
  it('marks it handled and can put it back', async () => {
    const comment = await leave('Needs a number.');
    const id = comment?.id ?? '';
    expect(await setCommentHandled(tx(), APP, id, { by: USER })).toBe(true);
    const [handled] = await loadComments(tx(), APP);
    expect(handled?.handledAt).not.toBeNull();

    expect(await setCommentHandled(tx(), APP, id, null)).toBe(true);
    const [again] = await loadComments(tx(), APP);
    expect(again?.handledAt).toBeNull();
  });

  it('says when nothing changed', async () => {
    const comment = await leave('Needs a number.');
    const id = comment?.id ?? '';
    expect(await setCommentHandled(tx(), APP, id, { by: USER })).toBe(true);
    // Already handled: the screen should say so rather than claim to have
    // done it twice.
    expect(await setCommentHandled(tx(), APP, id, { by: USER })).toBe(false);
  });

  it('cannot be reached with an id from another application', async () => {
    const comment = await leave('Mine.');
    expect(await setCommentHandled(tx(), OTHER_APP, comment?.id ?? '', { by: USER })).toBe(false);
    const [untouched] = await loadComments(tx(), APP);
    expect(untouched?.handledAt).toBeNull();
  });

  it('keeps what the reviewer said once it is dealt with', async () => {
    // Handled is not deleted: what a reviewer said is worth keeping even once
    // it has been answered.
    const comment = await leave('Needs a number.');
    await setCommentHandled(tx(), APP, comment?.id ?? '', { by: USER });
    const [kept] = await loadComments(tx(), APP);
    expect(kept?.body).toBe('Needs a number.');
    expect(kept?.reviewerName).toBe('Jan, our treasurer');
  });
});

describe('naming the question for the trail', () => {
  it('gives the position, not the id', async () => {
    expect(await questionNumber(tx(), APP, Q1)).toBe(1);
  });

  it('refuses a question from another application', async () => {
    expect(await questionNumber(tx(), APP, OTHER_Q)).toBeNull();
  });

  it('refuses one that does not exist', async () => {
    expect(await questionNumber(tx(), APP, 'q_never')).toBeNull();
  });
});
