import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../types.js';
import { AnthropicProvider, createProvider, DEFAULT_MODEL } from './anthropic.js';

describe('when no API key is configured', () => {
  it('refuses to construct rather than pretending to work', () => {
    expect(() => new AnthropicProvider({ apiKey: '' })).toThrow(AiUnavailableError);
    expect(() => new AnthropicProvider({ apiKey: '   ' })).toThrow(AiUnavailableError);
  });

  it('reports unavailability with a reason a user can act on', () => {
    const result = createProvider({ apiKey: '' });
    expect(result.available).toBe(false);
    if (result.available) return;
    expect(result.reason).toContain('No Anthropic API key');
    expect(result.reason).toContain('unavailable');
  });

  it('offers no fallback that could return invented output', () => {
    const result = createProvider({ apiKey: '' });
    expect(result).not.toHaveProperty('provider');
  });
});

describe('when an API key is configured', () => {
  it('builds a provider', () => {
    const result = createProvider({ apiKey: 'sk-ant-test-key-not-real' });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.provider.name).toBe('anthropic');
  });

  it('defaults to the current Opus model', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-5');
  });
});
