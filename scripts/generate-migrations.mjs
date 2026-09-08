/**
 * Inline the migration SQL into a TypeScript module.
 *
 * The .sql files stay the source of truth for anyone reading or writing a
 * migration. This turns them into a value the bundler can see, because reading
 * them from disk at runtime does not survive deployment: the filenames are
 * built from a list at runtime, so Next cannot trace them, and they are simply
 * absent from the serverless bundle. That failed in production with ENOENT on
 * the first request that touched data.
 *
 * The generated file is committed, so no build step is required to deploy, and
 * a test asserts it still matches the .sql files so the two cannot drift.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/db/migrations/', import.meta.url));
const out = fileURLToPath(new URL('../src/db/migrations.generated.ts', import.meta.url));

export async function render() {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).toSorted();
  const entries = await Promise.all(
    names.map(async (name) => `  ${JSON.stringify(name)}: ${JSON.stringify(await readFile(dir + name, 'utf8'))},`),
  );
  return `/**
 * GENERATED FILE — do not edit.
 *
 * Run \`npm run migrations:generate\` after changing anything in
 * src/db/migrations/. \`migrations.generated.test.ts\` fails if this drifts.
 *
 * The SQL is inlined rather than read from disk because a serverless bundle
 * does not contain files nothing statically refers to, and the migration
 * filenames are assembled at runtime.
 */

export const MIGRATION_SQL: Readonly<Record<string, string>> = {
${entries.join('\n')}
};
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await writeFile(out, await render(), 'utf8');
  console.log(`wrote ${out}`);
}
