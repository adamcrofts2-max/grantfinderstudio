/**
 * A caught redirect is a dead end, so this is what stops one being caught.
 */
import { describe, expect, it } from 'vitest';

import { rethrowControlFlow } from './control-flow.js';

const withDigest = (digest: unknown): Error => {
  const error = new Error('thrown by the framework');
  (error as Error & { digest?: unknown }).digest = digest;
  return error;
};

describe('rethrowControlFlow', () => {
  it('re-throws a redirect', () => {
    // The real shape: Next puts the destination and status in the digest.
    const redirect = withDigest('NEXT_REDIRECT;push;/sign-in;307;');
    expect(() => rethrowControlFlow(redirect)).toThrow(redirect);
  });

  it('re-throws a not-found', () => {
    const notFound = withDigest('NEXT_NOT_FOUND');
    expect(() => rethrowControlFlow(notFound)).toThrow(notFound);
  });

  it('lets a real error past, to be handled as one', () => {
    // The point of being narrow: a database failure must still reach the
    // catch that turns it into a message, not be re-thrown at the framework.
    expect(() => rethrowControlFlow(new Error('connection terminated'))).not.toThrow();
    expect(() => rethrowControlFlow(withDigest('SOMETHING_ELSE'))).not.toThrow();
  });

  it('is not fooled by a digest that is not a string', () => {
    expect(() => rethrowControlFlow(withDigest(42))).not.toThrow();
    expect(() => rethrowControlFlow(withDigest({ redirect: true }))).not.toThrow();
  });

  it('survives being handed anything at all', () => {
    for (const value of [null, undefined, 'a string', 7, [], new Error('plain')]) {
      expect(() => rethrowControlFlow(value)).not.toThrow();
    }
  });

  it('does not treat a message mentioning a redirect as one', () => {
    // Only the digest counts. A database error whose text happens to contain
    // the words must not be re-thrown at the framework as control flow.
    expect(() => rethrowControlFlow(new Error('NEXT_REDIRECT'))).not.toThrow();
  });
});
