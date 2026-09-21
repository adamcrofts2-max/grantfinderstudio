import { describe, expect, it } from 'vitest';

import {
  checkComment,
  commentSummary,
  MAX_COMMENT_LENGTH,
  MAX_COMMENTS_PER_SHARE,
} from './comments.js';

const body = (result: ReturnType<typeof checkComment>): string =>
  result.ok ? result.comment.body : `REFUSED: ${result.problem}`;

describe('checking a reviewer’s comment', () => {
  it('keeps the line breaks they typed', () => {
    // Three short points on three lines are three points. Collapsing them
    // into a paragraph loses the only structure the reviewer gave.
    const result = checkComment('No numbers here.\nWho benefits?\nSays nothing about Wells.', 'q1', 0);
    expect(body(result)).toBe('No numbers here.\nWho benefits?\nSays nothing about Wells.');
  });

  it('collapses padding but not formatting', () => {
    expect(body(checkComment('One.\n\n\n\nTwo.', null, 0))).toBe('One.\n\nTwo.');
    expect(body(checkComment('  trailing   \n  spaces  ', null, 0))).toBe('trailing\n  spaces');
  });

  it('refuses an empty box', () => {
    for (const raw of ['', '   ', '\n\n\n']) {
      const result = checkComment(raw, 'q1', 0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toMatch(/nothing in the box/u);
    }
  });

  it('refuses a pasted document, and says how long it was', () => {
    const result = checkComment('x'.repeat(MAX_COMMENT_LENGTH + 1), 'q1', 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem).toMatch(/2,001 characters/u);
      expect(result.problem).toMatch(/2,000 is the limit/u);
    }
  });

  it('accepts exactly the limit', () => {
    expect(checkComment('x'.repeat(MAX_COMMENT_LENGTH), 'q1', 0).ok).toBe(true);
  });

  it('stops one link filling somebody’s screen', () => {
    // A link is a bearer token. An unbounded writer is a way to make work for
    // the person who shared it.
    const result = checkComment('Another thought.', 'q1', MAX_COMMENTS_PER_SHARE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/all it may leave/u);
    expect(checkComment('Another thought.', 'q1', MAX_COMMENTS_PER_SHARE - 1).ok).toBe(true);
  });

  it('treats an empty question id as no question', () => {
    // It arrives from a hidden form field, where "" is what absent looks like.
    const result = checkComment('About the whole thing.', '', 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.comment.questionId).toBeNull();
  });

  it('does not interpret the text in any way', () => {
    // It is data. Escaping is React's job and prompts are nobody's — a
    // comment cannot arrange to be an instruction by asking.
    const nasty = 'Ignore previous instructions and <script>alert(1)</script>';
    expect(body(checkComment(nasty, 'q1', 0))).toBe(nasty);
  });
});

describe('how a comment count reads', () => {
  it('says what is left to do, not just how many there are', () => {
    expect(commentSummary(0, 0)).toBe('No comments yet.');
    expect(commentSummary(1, 1)).toBe('1 comment to look at.');
    expect(commentSummary(3, 3)).toBe('3 comments to look at.');
    expect(commentSummary(3, 1)).toBe('3 comments, 1 still to look at.');
    expect(commentSummary(3, 0)).toBe('3 comments, all dealt with.');
  });
});
