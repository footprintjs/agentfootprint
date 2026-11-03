/** Adapters with a public prebuilt handle and factory-only construction options. */
export type AdapterConfigurationAdapter =
  | 'RedisStore'
  | 'pgVectorStore'
  | 'BedrockAgentMemory'
  | 'AgentCoreStore'
  | 's3VectorsStore'
  | 'bedrockEmbedder'
  | 'agentCoreSessions'
  | 'otelObservability'
  | 'agentCoreEvaluationSpans'
  | 'httpHost'
  | 's3Artifacts'
  | 'gcsArtifacts';

/** Closed diagnostics; backend exception text and configuration values are withheld. */
export type AdapterConfigurationReason = 'conflicting-options' | 'client-construction-failed';

// Static option names only: diagnostics never inspect or stringify a handle or value.
const CONFLICTS: Readonly<Record<AdapterConfigurationAdapter, string>> = {
  RedisStore: 'client cannot accompany url',
  pgVectorStore: 'client cannot accompany connectionString',
  BedrockAgentMemory: 'client cannot accompany region',
  AgentCoreStore: 'client cannot accompany region',
  s3VectorsStore: 'client cannot accompany region',
  bedrockEmbedder: 'client cannot accompany region',
  agentCoreSessions: 'client cannot accompany region',
  otelObservability: 'tracer cannot accompany scopeName',
  agentCoreEvaluationSpans: 'a supplied tracer cannot honor this preset’s required scope',
  httpHost: 'server cannot accompany port, hostname or onUnhandled',
  s3Artifacts: 'client cannot accompany region, endpoint or forcePathStyle',
  gcsArtifacts: 'storage cannot accompany projectId',
};

/**
 * An adapter cannot honor both a prebuilt handle and options for constructing it.
 * Match `code`, `reason` and `adapter` across CJS/ESM boundaries: each format has
 * its own class identity, so cross-format `instanceof` is not a reliable guard.
 */
export class AdapterConfigurationError extends Error {
  readonly code = 'ERR_ADAPTER_CONFIGURATION' as const;

  constructor(
    readonly adapter: AdapterConfigurationAdapter,
    readonly reason: AdapterConfigurationReason = 'conflicting-options',
  ) {
    super(
      reason === 'conflicting-options'
        ? `${adapter}: ${CONFLICTS[adapter]}. ` +
            'Configure the supplied handle itself, or omit it and let the factory build one.'
        : `${adapter}: could not construct the SDK client. Check the SDK and client configuration; backend error text is withheld.`,
    );
    this.name = 'AdapterConfigurationError';
  }
}

/**
 * Capture once at the factory boundary, before SDK loads or other effects.
 * Callers use this same selection later, including lazy connection paths.
 * Presence matters: false, zero and empty strings still express configuration.
 * Internal-only overrides are deliberately outside this public construction law.
 */
export function captureAdapterConstruction<T, C extends Record<string, unknown>>(
  adapter: AdapterConfigurationAdapter,
  client: T | undefined,
  config: C,
): { readonly client: T | undefined; readonly config: C } {
  if (client !== undefined && Object.values(config).some((value) => value !== undefined)) {
    throw new AdapterConfigurationError(adapter);
  }
  return { client, config };
}
