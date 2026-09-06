/**
 * Provider-agnostic AI types.
 *
 * Nothing outside `src/ai/providers` may import a vendor SDK. Everything else
 * in the codebase depends only on this interface, so the provider can be
 * swapped, stubbed in tests, or reported unavailable without touching a single
 * call site.
 */

export interface AiRequest {
  /** Operator instructions. Never contains untrusted content. */
  system: string;
  /** The task. Untrusted material must already be wrapped (see untrusted.ts). */
  prompt: string;
  /** JSON Schema the response must satisfy. */
  outputSchema: Record<string, unknown>;
  maxTokens: number;
  /** Lower effort for mechanical extraction; higher for judgement. */
  effort: 'low' | 'medium' | 'high';
}

export interface AiUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AiResponse {
  /** Raw JSON text. Never trusted until schema-validated. */
  text: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

/**
 * Raised when no provider is configured.
 *
 * The product reports the feature as unavailable rather than returning
 * something invented. A fabricated answer is worse than a missing one.
 */
export class AiUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'AiUnavailableError';
  }
}

/** Raised when the model's output does not satisfy the schema after retries. */
export class AiSchemaError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'AiSchemaError';
  }
}

/** Raised when the model declines the request. */
export class AiRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(
      `The model declined this request${category === null ? '' : ` (${category})`}.`,
    );
    this.name = 'AiRefusalError';
  }
}
