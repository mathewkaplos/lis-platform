export interface InferenceProviderInput {
  capability: string;
  prompt: string;
  minimizedContext: Record<string, unknown>;
}

export interface InferenceProviderOutput {
  output: string;
  providerId: string;
}

/**
 * KB-45: providers are pluggable (self-hosted or API); this interface is
 * the swap point. Only `StubProvider` ships with FEAT-041 -- a real
 * provider (vendor, auth, retry/error handling) is deferred to whichever
 * feature first needs a live model call (FEAT-041 proposal §5/§6).
 */
export interface InferenceProvider {
  readonly providerId: string;
  complete(input: InferenceProviderInput): Promise<InferenceProviderOutput>;
}
