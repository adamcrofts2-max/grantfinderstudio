/**
 * Anthropic provider.
 *
 * The only file in the codebase permitted to import a vendor SDK.
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  AiRefusalError,
  AiUnavailableError,
  type AiProvider,
  type AiRequest,
  type AiResponse,
} from '../types.js';

export const DEFAULT_MODEL = 'claude-opus-5';

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
  /**
   * Where to send the request. Defaults to Anthropic.
   *
   * ## Environment variable ONLY, never a console setting
   *
   * The same rule `src/settings/registry.ts` states for Companies House, and
   * for the same reason: a request to this service carries the API key in a
   * header. A console-editable base URL would make the key readable by
   * redirect — point it at a host you control, wait for the next draft, and
   * `x-api-key` arrives on your server. A key encrypted at rest and masked
   * afterwards is write-only precisely so that cannot happen.
   *
   * An environment variable needs a redeploy and leaves a trace in the hosting
   * platform, which is the level of friction this deserves.
   *
   * It exists so the whole Writer path — draft, critic pass, review panel,
   * copy out — can be exercised against a stub that speaks the Anthropic wire
   * format. Before this, everything between "paste the questions" and "here is
   * your draft" was covered only by unit tests with a fake provider object,
   * and the real SDK call was exercised by nothing but production.
   */
  baseUrl?: string;
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env['ANTHROPIC_API_KEY'];
    if (apiKey === undefined || apiKey.trim() === '') {
      throw new AiUnavailableError(
        'No Anthropic API key is configured, so AI features are unavailable.',
      );
    }
    const baseUrl = (options.baseUrl ?? process.env['ANTHROPIC_BASE_URL'] ?? '').trim();
    this.client = new Anthropic(baseUrl === '' ? { apiKey } : { apiKey, baseURL: baseUrl });
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    const startedAt = Date.now();

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: request.maxTokens,
      system: request.system,
      // Adaptive thinking; effort carries the cost/quality trade-off.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: request.effort,
        format: {
          type: 'json_schema',
          schema: request.outputSchema,
        },
      },
      messages: [{ role: 'user', content: request.prompt }],
    } as Anthropic.MessageCreateParamsNonStreaming);

    // A decline is not an error status — check before reading content.
    if (response.stop_reason === 'refusal') {
      throw new AiRefusalError(response.stop_details?.category ?? null);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      text,
      usage: {
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}

/**
 * Build a provider, or explain why there is not one.
 *
 * Returns the reason rather than throwing so callers can render an honest
 * "unavailable" state instead of a broken screen — and never a fake result.
 */
export function createProvider(
  options: AnthropicProviderOptions = {},
): { available: true; provider: AiProvider } | { available: false; reason: string } {
  try {
    return { available: true, provider: new AnthropicProvider(options) };
  } catch (error) {
    if (error instanceof AiUnavailableError) {
      return { available: false, reason: error.message };
    }
    throw error;
  }
}
