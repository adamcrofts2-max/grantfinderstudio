/**
 * Saving an answer, and the provenance rule that decides what happens to the
 * Writer's tracing when somebody types over it.
 *
 * Until this shipped there was no way to write an answer at all: each question
 * on the application offered one action, "Draft from my facts", and on a
 * deployment with no Anthropic key — the default — that left the central
 * screen of the product with nothing a person could do. The product promised
 * otherwise on three screens, including the tracker's entire effort model,
 * which assumes you write every answer yourself.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { correctFact, loadApplication, loadClaimRefs, saveAnswer } from './workspace.js';
import { createTestDatabase, type TestDatabase } from './testing/harness.js';
import type { Queryable } from './client.js';

let harness: TestDatabase;
const tx = (): Queryable => harness.db as unknown as Queryable;

const ORG = 'org_answers';
const APP = 'app_answers';
const Q = 'q_answers_1';

beforeEach(async () => {
  harness = await createTestDatabase();
  await harness.db.exec('RESET ROLE;');
  await harness.db.exec(`
    INSERT INTO organisations (id, name) VALUES ('${ORG}', 'Rivermead CIC');
    INSERT INTO applications (id, organisation_id, status)
      VALUES ('${APP}', '${ORG}', 'saved');
    INSERT INTO application_questions
      (id, organisation_id, application_id, position, question, word_limit)
      VALUES ('${Q}', '${ORG}', '${APP}', 1,
              'Tell us about your organisation and what you exist to do.', 200);
    INSERT INTO facts (id, organisation_id, claim, value, source, retrieved_at)
      VALUES ('fact_mission', '${ORG}', 'mission', 'We train young people in Wells.',
              'user', now());
  `);
});

afterEach(async () => {
  await harness.close();
});

const save = (content: string, claims: Array<{ text: string; factId: string | null }>) =>
  saveAnswer(tx(), ORG, { questionId: Q, content, wordCount: 4, claims }, null);

describe('an answer somebody wrote themselves', () => {
  it('is stored, and comes back on the application', async () => {
    await save('We train young people in Wells and have done since 2021.', []);

    const application = await loadApplication(tx(), APP);
    expect(application?.answers.get(Q)?.content).toBe(
      'We train young people in Wells and have done since 2021.',
    );
  });

  it('carries no fact tracing, because there is none to carry', async () => {
    await save('Words of my own.', []);
    expect(await loadClaimRefs(tx(), Q)).toEqual([]);
  });

  it('CLEARS the tracing from a draft it replaces', async () => {
    // The rule that matters. Sentence-by-sentence tracing describes text the
    // Writer produced against the facts it was given; it says nothing true
    // about text somebody typed afterwards. Keeping the old refs would leave
    // the screen highlighting sentences that are no longer there and
    // crediting facts to words nobody checked — the fabrication this product
    // exists to refuse.
    await save('We train young people in Wells.', [
      { text: 'We train young people in Wells.', factId: 'fact_mission' },
    ]);
    expect(await loadClaimRefs(tx(), Q)).toHaveLength(1);

    await save('Actually we do something rather different now.', []);
    expect(await loadClaimRefs(tx(), Q)).toEqual([]);
  });

  it('keeps every version, so nothing is lost by overwriting', async () => {
    await save('First attempt.', []);
    await save('Second attempt.', []);

    const { rows } = await harness.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM answer_versions WHERE answer_id = 'ans_${Q}'`,
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('can be emptied, which is a person deciding not to answer', async () => {
    await save('Something.', []);
    await save('', []);

    const application = await loadApplication(tx(), APP);
    expect(application?.answers.get(Q)?.content).toBe('');
    expect(await loadClaimRefs(tx(), Q)).toEqual([]);
  });
});

describe('saving the same answer twice in one millisecond', () => {
  it('keeps both versions rather than colliding on the key', async () => {
    // The version id was the question and the time, so a double click — or a
    // fast test on CI — failed on the primary key. The clock is frozen here
    // so the collision is certain rather than a matter of luck.
    const frozen = vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    try {
      await save('First go.', []);
      await save('Second go.', []);
      await save('Third go.', []);
    } finally {
      frozen.mockRestore();
    }
    const { rows } = await tx().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM answer_versions',
    );
    expect(rows[0]?.n).toBe('3');
  });
});

describe('correcting a fact twice in one millisecond', () => {
  it('stores both corrections rather than colliding on the key', async () => {
    // The same time-only id as answer versions had, one table along.
    await harness.db.exec(`INSERT INTO users (id, email) VALUES ('user_fix', 'fix@example.org')`);
    const frozen = vi.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    try {
      await correctFact(tx(), 'fact_mission', 'We train young people in Wells and Frome.', 'user_fix');
      await correctFact(tx(), 'fact_mission', 'We train young people across Somerset.', 'user_fix');
    } finally {
      frozen.mockRestore();
    }
    const { rows } = await tx().query<{ n: string }>(
      "SELECT count(*)::text AS n FROM facts WHERE id LIKE 'fact_mission_r%'",
    );
    expect(rows[0]?.n).toBe('2');
  });
});
