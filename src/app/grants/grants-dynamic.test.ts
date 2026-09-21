/**
 * `/grants` must stay `force-dynamic`, and the corpus actions must not
 * revalidate it.
 *
 * These two facts hold each other up. The corpus step used to call
 * `revalidatePath('/grants')`, which buys nothing on a route that is never
 * cached and costs a client that is mid-hydration its tree: revalidating
 * invalidates the client router cache for anybody holding the page, the
 * payload is re-fetched at a later moment of the load, and it no longer
 * matches the HTML being hydrated. React #418, about one e2e run in two,
 * always inside a load.
 *
 * So the revalidation went. If `/grants` ever becomes cacheable, an applicant
 * would then be served a stale corpus and nothing would say so — hence this
 * test rather than a comment.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('the applicant’s grant search', () => {
  it('is force-dynamic, so it never serves a cached corpus', () => {
    expect(read('src/app/grants/page.tsx')).toMatch(
      /export const dynamic = 'force-dynamic'/u,
    );
  });
});

describe('the corpus actions', () => {
  /**
   * The code, with the comments taken out.
   *
   * The note explaining why the revalidation went away quotes the call it is
   * about, and a naive search finds the explanation and calls it the offence.
   */
  const actions = read('src/app/admin/funders/corpus-actions.ts')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');

  it('revalidate the console they return to', () => {
    expect(actions).toContain("revalidatePath('/admin/funders')");
  });

  it('do not revalidate the applicant’s search', () => {
    // Not a style rule: see the note at the top.
    expect(actions).not.toContain("revalidatePath('/grants')");
  });
});
