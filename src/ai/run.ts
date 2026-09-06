/**
 * Agent runner.
 *
 * Every AI call in this product goes through here, so the guarantees are in
 * one place:
 *
 *   - output is parsed and schema-validated before anything downstream sees it
 *   - a malformed response is retried once, then fails visibly
 *   - failure is an error, never a partially-parsed guess or a default value
 *   - usage is recorded for the ai_generations table
 *
 * The last point matters most. Silently accepting half-valid output is how a
 * fabricated fact reaches a funding application.
 */

import type { ZodType } from 'zod';
import { AiSchemaError, type AiProvider, type AiRequest, type AiUsage } from './types.js';

export interface AgentDefinition<T> {
  name: string;
  /** Bumped whenever the prompt changes, and recorded with every generation. */
  promptVersion: string;
  system: string;
  outputSchema: Record<string, unknown>;
  parser: ZodType<T>;
  maxTokens: number;
  effort: AiRequest['effort'];
}

export interface AgentResult<T> {
  output: T;
  usage: AiUsage;
  agent: string;
  promptVersion: string;
  /** Attempts taken, including the successful one. */
  attempts: number;
}

const MAX_ATTEMPTS = 2;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError('the response was not valid JSON');
  }
}

export async function runAgent<T>(
  provider: AiProvider,
  definition: AgentDefinition<T>,
  prompt: string,
): Promise<AgentResult<T>> {
  const problems: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await provider.complete({
      system: definition.system,
      prompt:
        attempt === 1
          ? prompt
          : `${prompt}\n\nYour previous response was rejected because ${problems.at(-1)}. Return only JSON matching the schema.`,
      outputSchema: definition.outputSchema,
      maxTokens: definition.maxTokens,
      effort: definition.effort,
    });

    let parsed: unknown;
    try {
      parsed = parseJson(response.text);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : 'it could not be parsed');
      continue;
    }

    const result = definition.parser.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      problems.push(
        issue
          ? `it did not match the schema at ${issue.path.join('.') || 'the root'}: ${issue.message}`
          : 'it did not match the schema',
      );
      continue;
    }

    return {
      output: result.data,
      usage: response.usage,
      agent: definition.name,
      promptVersion: definition.promptVersion,
      attempts: attempt,
    };
  }

  throw new AiSchemaError(
    `${definition.name} did not return valid output after ${MAX_ATTEMPTS} attempts: ${problems.join('; ')}`,
    MAX_ATTEMPTS,
  );
}
