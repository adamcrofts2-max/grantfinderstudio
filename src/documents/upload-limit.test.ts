/**
 * The framework must accept what the product promises to.
 *
 * Next caps a server action's body at 1 MB unless told otherwise, and the
 * document upload is a server action. The upload form said "up to 15 MB" and
 * anything over one failed with a framework error — two numbers in two files,
 * and nothing holding them together. This does.
 */

import { describe, expect, it } from 'vitest';

import nextConfig from '../../next.config.mjs';
import { UPLOAD_LIMITS } from './accepted.js';

function bytes(limit: string): number {
  const match = /^(\d+)\s*(kb|mb)$/iu.exec(limit.trim());
  if (match === null) throw new Error(`unreadable limit: ${limit}`);
  return Number(match[1]) * (match[2]!.toLowerCase() === 'mb' ? 1024 * 1024 : 1024);
}

describe('the server action body limit', () => {
  it('admits the largest upload the product promises, with room for the form around it', () => {
    const limit = (nextConfig as { experimental?: { serverActions?: { bodySizeLimit?: string } } })
      .experimental?.serverActions?.bodySizeLimit;
    expect(limit).toBeDefined();
    expect(bytes(limit!)).toBeGreaterThan(UPLOAD_LIMITS.maxBytes);
  });

  it('is not raised further than it needs to be', () => {
    // Every server action gets this limit, not only the upload: it is also
    // how large a body anybody may send to any form.
    const limit = (nextConfig as { experimental?: { serverActions?: { bodySizeLimit?: string } } })
      .experimental?.serverActions?.bodySizeLimit;
    expect(bytes(limit!)).toBeLessThanOrEqual(UPLOAD_LIMITS.maxBytes + 2 * 1024 * 1024);
  });
});
