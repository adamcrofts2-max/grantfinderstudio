import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runAgent, type AgentDefinition } from './run.js';
import { AiSchemaError, type AiProvider, type AiRequest, type AiResponse } from './types.js';

const definition: AgentDefinition<{ value: string }> = {
  name: 'test-agent',
  promptVersion: '1.0.0',
  system: 'You are a test.',
  outputSchema: { type: 'object' },
  parser: z.object({ value: z.string() }),
  maxTokens: 100,
  effort: 'low',
};

/** Returns queued responses in order, recording every request it received. */
class ScriptedProvider implements AiProvider {
  readonly name = 'scripted';
  readonly requests: AiRequest[] = [];
  constructor(private readonly responses: string[]) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    this.requests.push(request);
    const text = this.responses.shift();
    if (text === undefined) throw new Error('no scripted response left');
    return {
      text,
      usage: { model: 'test', inputTokens: 10, outputTokens: 5, latencyMs: 1 },
    };
  }
}

describe('runAgent', () => {
  it('returns validated output on the first attempt', async () => {
    const provider = new ScriptedProvider(['{"value":"hello"}']);
    const result = await runAgent(provider, definition, 'do the thing');
    expect(result.output).toEqual({ value: 'hello' });
    expect(result.attempts).toBe(1);
  });

  it('records the agent, prompt version and usage for the audit trail', async () => {
    const provider = new ScriptedProvider(['{"value":"hello"}']);
    const result = await runAgent(provider, definition, 'do the thing');
    expect(result.agent).toBe('test-agent');
    expect(result.promptVersion).toBe('1.0.0');
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('retries once when the response is not JSON', async () => {
    const provider = new ScriptedProvider(['not json at all', '{"value":"ok"}']);
    const result = await runAgent(provider, definition, 'go');
    expect(result.output).toEqual({ value: 'ok' });
    expect(result.attempts).toBe(2);
  });

  it('retries when the JSON does not match the schema', async () => {
    const provider = new ScriptedProvider(['{"value":42}', '{"value":"ok"}']);
    const result = await runAgent(provider, definition, 'go');
    expect(result.attempts).toBe(2);
  });

  it('tells the model what was wrong when it retries', async () => {
    const provider = new ScriptedProvider(['{"value":42}', '{"value":"ok"}']);
    await runAgent(provider, definition, 'go');
    expect(provider.requests[1]?.prompt).toContain('did not match the schema');
    expect(provider.requests[1]?.prompt).toContain('value');
  });

  it('fails visibly rather than returning a guess', async () => {
    const provider = new ScriptedProvider(['nonsense', '{"wrong":true}']);
    await expect(runAgent(provider, definition, 'go')).rejects.toThrow(AiSchemaError);
  });

  it('names the agent and both problems in the failure', async () => {
    const provider = new ScriptedProvider(['nonsense', '{"wrong":true}']);
    await expect(runAgent(provider, definition, 'go')).rejects.toThrow(
      /test-agent.*not valid JSON.*did not match the schema/s,
    );
  });

  it('never returns a partial or defaulted object', async () => {
    const provider = new ScriptedProvider(['{}', '{}']);
    await expect(runAgent(provider, definition, 'go')).rejects.toThrow(AiSchemaError);
  });

  it('gives up after two attempts rather than looping', async () => {
    const provider = new ScriptedProvider(['bad', 'bad', '{"value":"ok"}']);
    await expect(runAgent(provider, definition, 'go')).rejects.toThrow(AiSchemaError);
    expect(provider.requests).toHaveLength(2);
  });

  it('passes the agent’s effort and token budget through', async () => {
    const provider = new ScriptedProvider(['{"value":"ok"}']);
    await runAgent(provider, definition, 'go');
    expect(provider.requests[0]).toMatchObject({ effort: 'low', maxTokens: 100 });
  });
});
