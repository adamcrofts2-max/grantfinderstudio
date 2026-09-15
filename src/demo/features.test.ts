/**
 * Features and "has anybody seen the form?" must travel together.
 *
 * They were set independently at two call sites and drifted, which is what two
 * copies of one fact always eventually do. The fund's own page derived
 * `featuresKnown` from the seed map; the opportunity list did not pass it at
 * all, so it defaulted to true over a zeroed feature set — and the same fund,
 * on the same day, read "an unknown amount of work" on one screen and "about 1
 * hour of work · LOW EFFORT" on the other.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_APPLICATION_FEATURES, applicationFeaturesFor } from './seed.js';

describe('applicationFeaturesFor', () => {
  it('reports a seeded fund as known', () => {
    const [id] = Object.keys(DEMO_APPLICATION_FEATURES);
    expect(id, 'the seed map is empty, so this test proves nothing').toBeDefined();
    const found = applicationFeaturesFor(id as string);
    expect(found.known).toBe(true);
    expect(found.features.questionCount).toBeGreaterThan(0);
  });

  it('reports a fund nobody has seen the form for as NOT known', () => {
    const found = applicationFeaturesFor('opp_typed_by_a_person');
    expect(found.known).toBe(false);
  });

  it('still returns usable zeroes, so the effort model need not special-case it', () => {
    const found = applicationFeaturesFor('opp_typed_by_a_person');
    expect(found.features.questionCount).toBe(0);
    expect(found.features.totalWordBudget).toBe(0);
    expect(found.features.requiredPolicies).toEqual([]);
  });

  it('cannot hand out the numbers without the caveat', () => {
    // The point of the helper. A caller destructuring this gets both or
    // neither; there is no shape in which the estimate arrives alone.
    expect(Object.keys(applicationFeaturesFor('anything')).toSorted()).toEqual([
      'features',
      'known',
    ]);
  });
});
