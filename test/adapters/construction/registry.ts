import { createServer } from 'node:http';

import { RedisStore } from '../../../src/adapters/memory/redis.js';
import { pgVectorStore } from '../../../src/adapters/memory/pgVector.js';
import { BedrockAgentMemory } from '../../../src/adapters/memory/bedrockAgentMemory.js';
import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import { s3VectorsStore } from '../../../src/adapters/memory/s3Vectors.js';
import { bedrockEmbedder } from '../../../src/embedders/index.js';
import { otelObservability } from '../../../src/adapters/observability/otel.js';
import { agentCoreEvaluationSpans } from '../../../src/adapters/observability/agentcore.js';
import {
  agentCoreRuntimeHost,
  agentCoreSessions,
} from '../../../src/adapters/hosting/agentcore.js';
import { foundryResponsesHost } from '../../../src/adapters/hosting/foundryResponses.js';
import { agentCoreA2AHost } from '../../../src/adapters/hosting/agentCoreA2A.js';
import { httpHost } from '../../../src/hosting/httpHost.js';
import { jsonWire, nodeHost } from '../../../src/hosting/nodeHost.js';
import { s3Artifacts } from '../../../src/artifacts/s3Artifacts.js';
import { gcsArtifacts } from '../../../src/artifacts/gcsArtifacts.js';
import { fakeGcs } from '../../artifacts/fakes/objectServices.js';
import type { AdapterConfigurationAdapter } from '../../../src/lib/adapterConfiguration.js';

export type Options = Record<string, unknown>;
export interface ConflictField {
  readonly key: string;
  readonly values: readonly unknown[];
}
export interface ConstructionFixture {
  readonly options: Options;
  readonly effects: string[];
  readonly handle: object;
}
export interface ConstructionCase {
  readonly entry: string;
  readonly adapter: AdapterConfigurationAdapter;
  readonly source: string;
  readonly handleKey: string;
  readonly privateKey?: string;
  readonly implicitConflict?: boolean;
  readonly fields: readonly ConflictField[];
  readonly fixture: () => ConstructionFixture;
  readonly create: (options: Options) => unknown;
}

export const PRIVATE_VALUE = 'PRIVATE_CONFIGURATION_SENTINEL';
const textField = (key: string): ConflictField => ({ key, values: [PRIVATE_VALUE, ''] });
const hostFields: readonly ConflictField[] = [
  { key: 'port', values: [0, 31987] },
  textField('hostname'),
  { key: 'onUnhandled', values: [() => PRIVATE_VALUE] },
];

/** Hand-written ports/modules only. A property read records crossing the SDK boundary. */
function fixture(handleKey: string, base: Options = {}): ConstructionFixture {
  const effects: string[] = [];
  class Command {
    constructor(readonly input: unknown) {}
  }
  class Client {
    constructor(readonly config: unknown) {
      effects.push('client-construction');
    }
    async send(): Promise<unknown> {
      effects.push('owned-send');
      return {};
    }
    async query(): Promise<{ rows: never[] }> {
      effects.push('owned-query');
      return { rows: [] };
    }
  }
  const module: Options = {
    S3Client: Client,
    S3VectorsClient: Client,
    BedrockAgentRuntimeClient: Client,
    BedrockAgentCoreClient: Client,
    BedrockRuntimeClient: Client,
    Pool: Client,
    GetAgentMemoryCommand: Command,
    DeleteAgentMemoryCommand: Command,
    CreateEventCommand: Command,
    ListEventsCommand: Command,
    DeleteEventCommand: Command,
    GetIndexCommand: Command,
    PutVectorsCommand: Command,
    QueryVectorsCommand: Command,
    GetVectorsCommand: Command,
    ListVectorsCommand: Command,
    DeleteVectorsCommand: Command,
    InvokeModelCommand: Command,
    PutObjectCommand: Command,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
    DeleteObjectCommand: Command,
    ListObjectsV2Command: Command,
  };
  const sdk = new Proxy(module, {
    get(target, key) {
      effects.push(`sdk:${String(key)}`);
      return Reflect.get(target, key);
    },
  });
  let handle: object;
  if (handleKey === 'server') {
    // Construction needs no socket. A borrowed server is not listened on here.
    const server = createServer();
    const on = server.on.bind(server);
    server.on = ((...args: Parameters<typeof server.on>) => {
      effects.push('listener');
      return on(...args);
    }) as typeof server.on;
    handle = server;
  } else if (handleKey === 'storage') {
    handle = fakeGcs().storage;
  } else if (handleKey === 'tracer') {
    handle = {
      startSpan: () => {
        effects.push('span');
        return { setAttribute() {}, setStatus() {}, end() {} };
      },
    };
  } else {
    handle = {
      get: async () => null,
      query: async () => ({ rows: [] }),
      send: async () => ({}),
      listEvents: async () => ({ events: [] }),
      createEvent: async () => undefined,
      getSessionSummaries: async () => ({ summaries: [] }),
      deleteMemory: async () => undefined,
      quit: async () => effects.push('borrowed-quit'),
      end: async () => effects.push('borrowed-end'),
      close: async () => effects.push('borrowed-close'),
      destroy: () => effects.push('borrowed-destroy'),
    };
  }
  handle = new Proxy(handle, {
    get(target, key, receiver) {
      effects.push(`borrowed-member:${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  });
  return {
    effects,
    handle,
    options: { ...base, [handleKey]: handle, _sdk: sdk, _pg: sdk, sdk },
  };
}

export const constructionRegistry: readonly ConstructionCase[] = [
  {
    entry: 'RedisStore',
    adapter: 'RedisStore',
    source: 'src/adapters/memory/redis.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('url')],
    fixture: () => fixture('client', { prefix: 'contract', scanCount: 7 }),
    create: (o) => new RedisStore(o as ConstructorParameters<typeof RedisStore>[0]),
  },
  {
    entry: 'pgVectorStore',
    adapter: 'pgVectorStore',
    source: 'src/adapters/memory/pgVector.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('connectionString')],
    fixture: () => fixture('client', { schema: 'public', table: 'contract_vectors', batchSize: 3 }),
    create: (o) => pgVectorStore(o as Parameters<typeof pgVectorStore>[0]),
  },
  {
    entry: 'BedrockAgentMemory',
    adapter: 'BedrockAgentMemory',
    source: 'src/adapters/memory/bedrockAgentMemory.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('region')],
    fixture: () => fixture('client', { agentId: 'agent', agentAliasId: 'alias' }),
    create: (o) =>
      new BedrockAgentMemory(o as unknown as ConstructorParameters<typeof BedrockAgentMemory>[0]),
  },
  {
    entry: 'AgentCoreStore',
    adapter: 'AgentCoreStore',
    source: 'src/adapters/memory/agentcore.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('region')],
    fixture: () => fixture('client', { memoryId: 'memory', pageSize: 3 }),
    create: (o) =>
      new AgentCoreStore(o as unknown as ConstructorParameters<typeof AgentCoreStore>[0]),
  },
  {
    entry: 's3VectorsStore',
    adapter: 's3VectorsStore',
    source: 'src/adapters/memory/s3Vectors.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('region')],
    fixture: () => fixture('client', { bucket: 'vectors', index: 'passages', batchSize: 3 }),
    create: (o) => s3VectorsStore(o as unknown as Parameters<typeof s3VectorsStore>[0]),
  },
  {
    entry: 'bedrockEmbedder',
    adapter: 'bedrockEmbedder',
    source: 'src/embedders/index.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('region')],
    fixture: () => fixture('client', { dimensions: 256, maxInputChars: 200 }),
    create: (o) => bedrockEmbedder(o as Parameters<typeof bedrockEmbedder>[0]),
  },
  {
    entry: 'agentCoreSessions',
    adapter: 'agentCoreSessions',
    source: 'src/adapters/hosting/agentcore.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [textField('region')],
    fixture: () => fixture('client', { store: 'memory', memoryId: 'memory', actorId: 'actor' }),
    create: (o) => agentCoreSessions(o as unknown as Parameters<typeof agentCoreSessions>[0]),
  },
  {
    entry: 'otelObservability',
    adapter: 'otelObservability',
    source: 'src/adapters/observability/otel.ts',
    handleKey: 'tracer',
    fields: [textField('scopeName')],
    fixture: () =>
      fixture('tracer', { serviceName: 'contract', captureContent: false, sampleRate: 0 }),
    create: (o) => otelObservability(o as unknown as Parameters<typeof otelObservability>[0]),
  },
  {
    entry: 'agentCoreEvaluationSpans',
    adapter: 'agentCoreEvaluationSpans',
    source: 'src/adapters/observability/agentcore.ts',
    handleKey: 'tracer',
    implicitConflict: true,
    fields: [{ key: 'scopeName', values: [undefined] }],
    fixture: () => fixture('tracer', { serviceName: 'contract', captureContent: false }),
    create: (o) =>
      agentCoreEvaluationSpans(o as unknown as Parameters<typeof agentCoreEvaluationSpans>[0]),
  },
  {
    entry: 'httpHost',
    adapter: 'httpHost',
    source: 'src/hosting/httpHost.ts',
    handleKey: 'server',
    fields: hostFields,
    fixture: () =>
      fixture('server', {
        name: PRIVATE_VALUE,
        wire: jsonWire,
        invokePath: '/invoke',
        healthPath: '/health',
        maxBodyBytes: 4096,
      }),
    create: (o) => httpHost(o as unknown as Parameters<typeof httpHost>[0]),
  },
  {
    entry: 'nodeHost',
    adapter: 'httpHost',
    source: 'src/hosting/nodeHost.ts',
    handleKey: 'server',
    fields: hostFields,
    fixture: () => fixture('server', { maxBodyBytes: 4096 }),
    create: (o) => nodeHost(o as Parameters<typeof nodeHost>[0]),
  },
  {
    entry: 'agentCoreRuntimeHost',
    adapter: 'httpHost',
    source: 'src/adapters/hosting/agentcore.ts',
    handleKey: 'server',
    fields: hostFields,
    fixture: () => fixture('server', { maxBodyBytes: 4096 }),
    create: (o) => agentCoreRuntimeHost(o as Parameters<typeof agentCoreRuntimeHost>[0]),
  },
  {
    entry: 'foundryResponsesHost',
    adapter: 'httpHost',
    source: 'src/adapters/hosting/foundryResponses.ts',
    handleKey: 'server',
    fields: hostFields,
    fixture: () => fixture('server', { model: 'contract-model', maxBodyBytes: 4096 }),
    create: (o) => foundryResponsesHost(o as Parameters<typeof foundryResponsesHost>[0]),
  },
  {
    entry: 'agentCoreA2AHost',
    adapter: 'httpHost',
    source: 'src/adapters/hosting/agentCoreA2A.ts',
    handleKey: 'server',
    fields: hostFields,
    fixture: () =>
      fixture('server', {
        card: { name: 'contract', description: 'contract', version: '1', skills: [] },
        maxBodyBytes: 4096,
      }),
    create: (o) => agentCoreA2AHost(o as unknown as Parameters<typeof agentCoreA2AHost>[0]),
  },
  {
    entry: 's3Artifacts',
    adapter: 's3Artifacts',
    source: 'src/artifacts/s3Artifacts.ts',
    handleKey: 'client',
    privateKey: '_client',
    fields: [
      textField('region'),
      textField('endpoint'),
      { key: 'forcePathStyle', values: [false, true] },
    ],
    fixture: () =>
      fixture('client', { bucket: 'artifacts', prefix: 'contract', retention: { ttlMs: 1000 } }),
    create: (o) => s3Artifacts(o as unknown as Parameters<typeof s3Artifacts>[0]),
  },
  {
    entry: 'gcsArtifacts',
    adapter: 'gcsArtifacts',
    source: 'src/artifacts/gcsArtifacts.ts',
    handleKey: 'storage',
    privateKey: '_storage',
    fields: [textField('projectId')],
    fixture: () =>
      fixture('storage', { bucket: 'artifacts', prefix: 'contract', retention: { ttlMs: 1000 } }),
    create: (o) => gcsArtifacts(o as unknown as Parameters<typeof gcsArtifacts>[0]),
  },
];

/** Reviewed exclusions: they are not constructor-only options silently dropped by public handles. */
export const constructionExclusions = [
  {
    entry: 'internal underscore handles',
    reason: 'Private test-seam precedence is outside this public-handle law (Claude ruling 1).',
  },
  {
    entry: 'firestoreSessions',
    reason:
      'Already refuses firestore with project/database before SDK load; existing TypeError is preserved.',
  },
  {
    entry: 'mcpClient connection / pool',
    reason:
      'Already refuses conflicting connection/transport configuration; existing refusal shape is preserved.',
  },
  {
    entry: 'agentCoreRuntimeMcpTransport',
    reason: 'region still supplies invocation and stop URLs beside an injected SigV4 client.',
  },
  {
    entry: 'staticEmbedder',
    reason:
      'module still declares the returned embedding-space identity beside an injected backend.',
  },
  {
    entry: 'localEmbedder / SDK module overrides',
    reason: 'Injected modules still receive construction options; they are not prebuilt handles.',
  },
  {
    entry: 'credential callbacks / scopes / Gemini door',
    reason: 'Still consumed per call, for redaction, or for operation/model selection.',
  },
] as const;

/** Exact metadata keys, joined to the behavioral rows rather than a per-file waiver. */
export const constructionBehaviorKeys: readonly string[] = [
  'src/adapters/memory/redis.ts#RedisStoreOptions.client',
  'src/adapters/memory/pgVector.ts#PgVectorStoreOptions.client',
  'src/adapters/memory/bedrockAgentMemory.ts#BedrockAgentMemoryOptions.client',
  'src/adapters/memory/agentcore.ts#AgentCoreStoreOptions.client',
  'src/adapters/memory/s3Vectors.ts#S3VectorsStoreOptions.client',
  'src/embedders/index.ts#BedrockEmbedderOptions.client',
  'src/adapters/hosting/agentcore.ts#AgentCoreMemorySessionsOptions.client',
  'src/adapters/observability/otel.ts#OtelObservabilityOptions.tracer',
  'src/hosting/httpHost.ts#HttpHostOptions.server',
  'src/hosting/nodeHost.ts#NodeHostOptions.server',
  'src/adapters/hosting/agentcore.ts#AgentCoreRuntimeHostOptions.server',
  'src/adapters/hosting/foundryResponses.ts#FoundryResponsesHostOptions.server',
  'src/adapters/hosting/agentCoreA2A.ts#AgentCoreA2AHostOptions.server',
  'src/artifacts/s3Artifacts.ts#S3ArtifactsOptions.client',
  'src/artifacts/gcsArtifacts.ts#GcsArtifactsOptions.storage',
  'src/adapters/hosting/agentcore.ts#SDK(createSessionClient).@aws-sdk/client-bedrock-agentcore',
  'src/adapters/memory/agentcore.ts#SDK(createAgentCoreClient).@aws-sdk/client-bedrock-agentcore',
  'src/adapters/memory/bedrockAgentMemory.ts#SDK(createBedrockAgentClient).@aws-sdk/client-bedrock-agent-runtime',
  'src/adapters/memory/pgVector.ts#SDK(loadPg).pg',
  'src/adapters/memory/redis.ts#SDK(createIoredis).ioredis',
  'src/adapters/memory/s3Vectors.ts#SDK(loadS3VectorsSdk).@aws-sdk/client-s3vectors',
  'src/adapters/observability/otel.ts#SDK(ensureTracer).@opentelemetry/api',
  'src/artifacts/gcsArtifacts.ts#SDK(loadGcsSdk).@google-cloud/storage',
  'src/artifacts/s3Artifacts.ts#SDK(loadS3Sdk).@aws-sdk/client-s3',
  'src/embedders/index.ts#SDK(loadBedrockRuntimeSdk).@aws-sdk/client-bedrock-runtime',
  'src/adapters/hosting/agentcore.ts#AgentCoreSessionsOptions.client',
];

/** Closed, reviewed inventory: adding a field/declaration/load site requires a fresh decision. */
const sourceExclusionGroups: readonly { reason: string; keys: readonly string[] }[] = [
  {
    reason:
      'Internal-only prebuilt-handle semantics remain outside the public law (Claude ruling 1).',
    keys: [
      'src/adapters/browser/agentcore.ts#AgentCoreBrowserOptions._client',
      'src/adapters/code/agentcore.ts#AgentCoreCodeRunnerOptions._client',
      'src/adapters/google/aiPlatform.ts#AiPlatformConnection._client',
      'src/adapters/hosting/agentcore.ts#AgentCoreMemorySessionsOptions._client',
      'src/adapters/hosting/agentcore.ts#AgentCoreSessionsOptions._client',
      'src/adapters/hosting/googleAgentEngine.ts#AgentEngineSessionsOptions._client',
      'src/adapters/identity/agentcore.ts#AgentCoreIdentityOptions._client',
      'src/adapters/identity/agentcore.ts#CompleteAgentCoreAuthorizationOptions._client',
      'src/adapters/identity/azure.ts#EntraIdentityOptions._credential',
      'src/adapters/identity/google.ts#GoogleIdentityOptions._client',
      'src/adapters/llm/AnthropicProvider.ts#AnthropicProviderOptions._client',
      'src/adapters/llm/BedrockProvider.ts#BedrockProviderOptions._client',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions._client',
      'src/adapters/llm/FoundryProvider.ts#FoundryProviderOptions._client',
      'src/adapters/llm/GeminiProvider.ts#GeminiProviderOptions._client',
      'src/adapters/llm/OpenAIProvider.ts#AzureOpenAIProviderOptions._client',
      'src/adapters/llm/OpenAIProvider.ts#OpenAIProviderOptions._client',
      'src/adapters/memory/agentcore.ts#AgentCoreStoreOptions._client',
      'src/adapters/memory/bedrockAgentMemory.ts#BedrockAgentMemoryOptions._client',
      'src/adapters/memory/memoryBank.ts#MemoryBankStoreOptions._client',
      'src/adapters/memory/pgVector.ts#PgVectorStoreOptions._client',
      'src/adapters/memory/redis.ts#RedisStoreOptions._client',
      'src/adapters/memory/s3Vectors.ts#S3VectorsStoreOptions._client',
      'src/adapters/observability/agentcore.ts#AgentcoreObservabilityOptions._client',
      'src/adapters/observability/cloudwatch.ts#CloudwatchObservabilityOptions._client',
      'src/adapters/observability/xray.ts#XrayObservabilityOptions._client',
      'src/artifacts/gcsArtifacts.ts#GcsArtifactsOptions._storage',
      'src/artifacts/s3Artifacts.ts#S3ArtifactsOptions._client',
      'src/embedders/index.ts#BedrockEmbedderOptions._client',
      'src/embedders/index.ts#GeminiEmbedderOptions._client',
      'src/mcp/types.ts#McpClientOptions._client',
      'src/mcp/types.ts#McpServeOptions._server',
    ],
  },
  {
    reason:
      'Module/constructor injection still builds the configured client or supplies command classes; it is not a prebuilt handle.',
    keys: [
      'src/adapters/browser/agentcore.ts#AgentCoreBrowserOptions._sdk',
      'src/adapters/code/agentcore.ts#AgentCoreCodeRunnerOptions._sdk',
      'src/adapters/code/agentcoreClient.ts#createCodeClient._sdk',
      'src/adapters/google/aiPlatform.ts#AiPlatformConnection._sdk',
      'src/adapters/hosting/agentcore.ts#AgentCoreMemorySessionsOptions._sdk',
      'src/adapters/hosting/agentcore.ts#AgentCoreSessionsOptions._sdk',
      'src/adapters/hosting/firestoreSessions.ts#FirestoreSessionsOptions._sdk',
      'src/adapters/hosting/googleAgentEngine.ts#AgentEngineSessionsOptions._sdk',
      'src/adapters/identity/agentcore.ts#AgentCoreIdentityOptions._sdk',
      'src/adapters/identity/agentcore.ts#CompleteAgentCoreAuthorizationOptions._sdk',
      'src/adapters/identity/azure.ts#EntraIdentityOptions._sdk',
      'src/adapters/identity/google.ts#GoogleIdentityOptions._sdk',
      'src/adapters/llm/BedrockProvider.ts#BedrockProviderOptions._commands',
      'src/adapters/llm/BedrockProvider.ts#BedrockProviderOptions._sdk',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions._commands',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions._sdk',
      'src/adapters/mcp/agentcoreRuntime/transport.ts#AgentCoreRuntimeMcpTransportOptions._sdk',
      'src/adapters/memory/bedrockAgentMemory.ts#BedrockAgentMemoryOptions._sdk',
      'src/adapters/memory/memoryBank.ts#MemoryBankStoreOptions._sdk',
      'src/adapters/memory/pgVector.ts#PgVectorStoreOptions._pg',
      'src/adapters/memory/s3Vectors.ts#S3VectorsStoreOptions._sdk',
      'src/adapters/memory/sqliteVector.ts#SqliteVectorStoreOptions._sqlite',
      'src/adapters/observability/agentcore.ts#AgentcoreObservabilityOptions._sdk',
      'src/adapters/observability/cloudwatch.ts#CloudwatchObservabilityOptions._sdk',
      'src/adapters/observability/otel.ts#OtelObservabilityOptions._otelApi',
      'src/adapters/observability/xray.ts#XrayObservabilityOptions._sdk',
      'src/artifacts/gcsArtifacts.ts#GcsArtifactsOptions._sdk',
      'src/artifacts/s3Artifacts.ts#S3ArtifactsOptions._sdk',
      'src/artifacts/sqliteArtifacts.ts#SqliteArtifactsOptions._sqlite',
      'src/embedders/index.ts#BedrockEmbedderOptions._sdk',
      'src/hosting/sqliteSessions.ts#SqliteSessionsOptions._sqlite',
    ],
  },
  {
    reason:
      'AWS browser/code prebuilt handles are internal-only; owned SDK path remains configured.',
    keys: [
      'src/adapters/browser/agentcore.ts#SDK(createBrowserClient).@aws-sdk/client-bedrock-agentcore',
      'src/adapters/code/agentcoreClient.ts#SDK(createCodeClient).@aws-sdk/client-bedrock-agentcore',
    ],
  },
  {
    reason:
      'Injected IO/opening implementation still receives the operation/resource configuration.',
    keys: [
      'src/adapters/code/local.ts#LocalCodeRunnerOptions._childProcess',
      'src/adapters/code/local.ts#LocalCodeRunnerOptions._fs',
      'src/adapters/identity/vault.ts#VaultCredentialsOptions._fetch',
      'src/adapters/llm/BrowserAnthropicProvider.ts#BrowserAnthropicProviderOptions._fetch',
      'src/adapters/llm/BrowserOpenAIProvider.ts#BrowserAzureOpenAIProviderOptions._fetch',
      'src/adapters/llm/BrowserOpenAIProvider.ts#BrowserOpenAIProviderOptions._fetch',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions._fetch',
      'src/adapters/llm/FoundryLocalProvider.ts#foundryLocal._fetch',
      'src/adapters/llm/FoundryLocalProvider.ts#FoundryLocalProvider._fetch',
      'src/adapters/llm/FoundryLocalProvider.ts#FoundryLocalProviderOptions._fetch',
      'src/adapters/llm/OllamaProvider.ts#ollama._fetch',
      'src/adapters/llm/OllamaProvider.ts#OllamaProvider._fetch',
      'src/adapters/llm/OllamaProvider.ts#OllamaProviderOptions._fetch',
      'src/adapters/observability/file.ts#FileObservabilityOptions._fs',
      'src/adapters/observability/githubBugReporter.ts#GithubBugReporterOptions._fetch',
      'src/adapters/observability/githubDeviceSignIn.ts#GithubDeviceSignInOptions._fetch',
      'src/mcp/pool/options.ts#McpClientPoolOptions._open',
    ],
  },
  {
    reason:
      'Google auth is consumed for owned construction; only private _client can override it, outside this public law.',
    keys: [
      'src/adapters/google/aiPlatform.ts#AiPlatformConnection.auth',
      'src/adapters/hosting/googleAgentEngine.ts#AgentEngineSessionsOptions.auth',
      'src/adapters/memory/memoryBank.ts#MemoryBankStoreOptions.auth',
    ],
  },
  {
    reason:
      'Shared Google SDK constructs the configured client; prebuilt _client is private, and resource path options remain live.',
    keys: ['src/adapters/google/aiPlatform.ts#SDK(buildAiPlatformClient).@googleapis/aiplatform'],
  },
  {
    reason:
      'Firestore already refuses project/database beside firestore before loading; preserve its existing TypeError contract.',
    keys: [
      'src/adapters/hosting/firestoreSessions.ts#FirestoreSessionsOptions.firestore',
      'src/adapters/hosting/firestoreSessions.ts#SDK(loadFirestoreSdk).@google-cloud/firestore',
    ],
  },
  {
    reason:
      'Identity SDK/module path constructs configured verifiers/clients; only private prebuilt seams bypass construction.',
    keys: [
      'src/adapters/identity/agentcore.ts#SDK(createIdentityClient).@aws-sdk/client-bedrock-agentcore',
      'src/adapters/identity/azure.ts#SDK(loadIdentitySdk).@azure/identity',
      'src/adapters/identity/directory/ldapDirectory.ts#SDK(loadLdapts).ldapts',
      'src/adapters/identity/google.ts#SDK(loadAuthSdk).google-auth-library',
      'src/adapters/identity/oidcSignIn.ts#SDK(loadOpenIdClient).openid-client',
      'src/adapters/identity/verify/jwtCore.ts#SDK(loadJose).jose',
    ],
  },
  {
    reason:
      'Injected identity backend still constructs/configures discovery, verifier or LDAP client from the declared settings.',
    keys: [
      'src/adapters/identity/directory/ldapDirectory.ts#LdapDirectoryOptions.backend',
      'src/adapters/identity/jwks.ts#JwksIdentityOptions.backend',
      'src/adapters/identity/oidc.ts#OidcIdentityOptions.backend',
      'src/adapters/identity/oidcSignIn.ts#OidcSignInOptions.backend',
      'src/adapters/identity/strategies/choose.ts#IdentityBootOptions.backend',
    ],
  },
  {
    reason:
      'Injected fetch still receives configured URL, headers, body and cancellation; it is operation IO.',
    keys: [
      'src/adapters/identity/oidc.ts#OidcIdentityOptions.fetch',
      'src/adapters/identity/oidc.ts#Settings.fetch',
      'src/adapters/identity/strategies/choose.ts#IdentityBootOptions.fetch',
      'src/adapters/identity/verify/discovery.ts#ReadDiscoveryOptions.fetch',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions.fetch',
      'src/adapters/llm/InvokeModelGatewayProvider.ts#InvokeModelGatewayOptions.fetch',
      'src/adapters/mcp/agentcore.ts#AgentCoreGatewayTransportOptions.fetch',
      'src/mcp/gatewayTransport.ts#createVendingFetch.fetch',
      'src/mcp/gatewayTransport.ts#GatewayTransportOptions.fetch',
    ],
  },
  {
    reason:
      'Credential remains a per-call signer/token source or OIDC client-auth input, not a discarded client-construction setting.',
    keys: [
      'src/adapters/identity/oidcSignIn.ts#OidcSignInOptions.credential',
      'src/adapters/identity/strategies/browserChoice.ts#BrowserSettings.credential',
      'src/adapters/llm/createProvider.ts#CreateProviderOptions.credential',
      'src/adapters/llm/FoundryProvider.ts#FoundryProviderOptions.credential',
      'src/adapters/llm/OpenAIProvider.ts#AzureOpenAIProviderOptions.credential',
    ],
  },
  {
    reason:
      'Provider SDK path has no supported public prebuilt-client conflict; private seams stay excluded and credential callbacks remain live.',
    keys: [
      'src/adapters/llm/AnthropicProvider.ts#SDK(resolveClient).@anthropic-ai/sdk',
      'src/adapters/llm/BedrockProvider.ts#SDK(resolveClient).@aws-sdk/client-bedrock-runtime',
      'src/adapters/llm/FoundryProvider.ts#SDK(resolveFoundryAuth).@azure/identity',
      'src/adapters/llm/googleGenAI.ts#SDK(resolveGoogleGenAIClient).@google/genai',
      'src/adapters/llm/OpenAIProvider.ts#SDK(resolveAzureClient).openai',
      'src/adapters/llm/OpenAIProvider.ts#SDK(resolveClient).openai',
    ],
  },
  {
    reason:
      'MCP runtime region is still URL/stop-URL identity; module injection supplies commands and public refusal controls already exist.',
    keys: [
      'src/adapters/mcp/agentcoreRuntime/invoke.ts#InvokeSdkOptions.client',
      'src/adapters/mcp/agentcoreRuntime/invoke.ts#SDK(loadSdk).@aws-sdk/client-bedrock-agentcore',
      'src/adapters/mcp/agentcoreRuntime/transport.ts#AgentCoreRuntimeMcpTransportOptions.auth',
      'src/adapters/mcp/agentcoreRuntime/transport.ts#AgentCoreRuntimeMcpTransportOptions.client',
    ],
  },
  {
    reason:
      'SDK module injection still constructs the configured client/transport or supplies command classes.',
    keys: [
      'src/adapters/mcp/agentcoreRuntime/invoke.ts#InvokeSdkOptions.sdk',
      'src/adapters/mcp/agentcoreRuntime/transport.ts#AgentCoreRuntimeMcpTransportOptions.sdk',
      'src/adapters/memory/agentcore.ts#AgentCoreStoreOptions.sdk',
      'src/mcp/pool/options.ts#McpClientPoolOptions.sdk',
      'src/mcp/types.ts#McpClientOptions.sdk',
    ],
  },
  {
    reason:
      'Internal resolved connection record, not a factory option or alternative client construction input.',
    keys: [
      'src/adapters/memory/s3Vectors.ts#Connection.client',
      'src/embedders/index.ts#Connection.client',
    ],
  },
  {
    reason:
      'CloudWatch/X-Ray prebuilt clients are internal-only; owned SDK path remains configured.',
    keys: [
      'src/adapters/observability/cloudwatch.ts#SDK(createCloudWatchClient).@aws-sdk/client-cloudwatch-logs',
      'src/adapters/observability/xray.ts#SDK(createXRayClient).@aws-sdk/client-xray',
    ],
  },
  {
    reason: 'Encoder module formats frames; there is no injected SDK-client construction choice.',
    keys: ['src/ag-ui/framing.ts#SDK(loadEncoder).@ag-ui/encoder'],
  },
  {
    reason:
      'Provider is an execution input; this declaration does not construct a competing provider client.',
    keys: [
      'src/core-flow/Parallel.ts#MergeWithLLMOptions.provider',
      'src/core/agent/buildAgentMessageApiChart.ts#buildAgentMessageApiChart.provider',
      'src/core/agent/buildMessageApiChart.ts#buildMessageApiChart.provider',
      'src/core/agent/stages/callLLM.ts#buildCallLLMStage.provider',
      'src/core/agent/stages/deliver.ts#buildDeliverStage.provider',
      'src/core/agent/thinkingSupport.ts#checkThinkingSupport.provider',
      'src/core/agent/types.ts#AgentOptions.provider',
      'src/core/LLMCall.ts#LLMCallOptions.provider',
      'src/injection-engine/constrainedEnumPick.ts#constrainedEnumPick.provider',
      'src/injection-engine/factories/defineInjection.ts#DefineInjectionOptions.provider',
      'src/injection-engine/factories/defineSkill.ts#defineSkillInjection.provider',
      'src/injection-engine/factories/defineSkill.ts#DefineSkillOptions.provider',
      'src/memory/beats/llmExtractor.ts#LLMExtractorConfig.provider',
      'src/memory/facts/llmFactExtractor.ts#LLMFactExtractorConfig.provider',
      'src/memory/pipeline/auto.ts#AutoPipelineConfig.provider',
      'src/patterns/Debate.ts#DebateOptions.provider',
      'src/patterns/LlmRouter.ts#LlmRouterOptions.provider',
      'src/patterns/LlmSwarm.ts#LlmSwarmOptions.provider',
      'src/patterns/MapReduce.ts#MapReduceOptions.provider',
      'src/patterns/Reflection.ts#ReflectionOptions.provider',
      'src/patterns/SelfConsistency.ts#SelfConsistencyOptions.provider',
      'src/patterns/ToT.ts#ToTOptions.provider',
      'src/trace-toolpack/traceDebugAgent.ts#TraceDebugAgentOptions.provider',
    ],
  },
  {
    reason: 'Credential provenance/evidence data, not a configurable SDK client handle.',
    keys: [
      'src/core/runbook/recording.ts#mintChartRecording.credential',
      'src/core/runbook/walk.ts#mintWalk.credential',
      'src/identity/types.ts#isCredentialIssued.credential',
    ],
  },
  {
    reason: 'Injected local backend still builds the declared model/dtype/cache pipeline.',
    keys: ['src/embedders/index.ts#LocalEmbedderOptions.backend'],
  },
  {
    reason: 'Local embedder module still builds the configured model/dtype/cache pipeline.',
    keys: ['src/embedders/index.ts#SDK(anonymous).@huggingface/transformers'],
  },
  {
    reason:
      'module still declares the embedding-space fingerprint with an injected static backend.',
    keys: ['src/embedders/index.ts#StaticEmbedderOptions.backend'],
  },
  {
    reason:
      'MCP connection/pool already refuses public construction conflicts; internal plan/settings objects and private seams add no new public conflict.',
    keys: [
      'src/mcp/connectionRefusals.ts#refuseConflictingOptions.connection',
      'src/mcp/mcpClient.ts#mcpClient.connection',
      'src/mcp/mcpClient.ts#OpenConnection.connection',
      'src/mcp/pool/options.ts#McpClientPoolOptions.transport',
      'src/mcp/pool/options.ts#PoolSettings.client',
      'src/mcp/pool/options.ts#PoolSettings.transport',
      'src/mcp/types.ts#McpClientOptions.transport',
      'src/mcp/types.ts#McpConnectionOptions.connection',
      'src/mcp/types.ts#McpServeOptions.transport',
    ],
  },
  {
    reason:
      'MCP loads support owned transports/servers; public connection conflicts already refuse and private handle seams stay excluded.',
    keys: [
      'src/mcp/mcpClient.ts#SDK(anonymous).@modelcontextprotocol/sdk',
      'src/mcp/mcpClient.ts#SDK(buildTransport).@modelcontextprotocol/sdk',
      'src/mcp/mcpClient.ts#SDK(loadClientModule).@modelcontextprotocol/sdk',
      'src/mcp/mcpClient.ts#SDK(loadHttpModule).@modelcontextprotocol/sdk',
      'src/mcp/mcpServe.ts#SDK(connectHttp).@modelcontextprotocol/sdk',
      'src/mcp/mcpServe.ts#SDK(connectTransport).@modelcontextprotocol/sdk',
      'src/mcp/mcpServe.ts#SDK(resolveRequestSchemas).@modelcontextprotocol/sdk',
      'src/mcp/mcpServe.ts#SDK(resolveServer).@modelcontextprotocol/sdk',
    ],
  },
  {
    reason: 'PDF backend has no competing construction settings to ignore.',
    keys: [
      'src/rag/loaders/pdf.ts#PdfLoaderOptions.backend',
      'src/rag/loaders/pdf.ts#SDK(anonymous).unpdf',
    ],
  },
  {
    reason:
      'Already-open MCP client is an execution input; this wrapper constructs no transport/client.',
    keys: ['src/tools/mcpClientUse.ts#servedUse.client'],
  },
];

export const constructionSourceExclusions = sourceExclusionGroups.flatMap(({ reason, keys }) =>
  keys.map((key) => ({ key, reason })),
);

/** Every option on a behavior-covered public-handle declaration is reviewed.
 * Adding a field requires a construction/operation decision, not blind snapshot refresh. */
export const constructionOptionShapes: readonly { key: string; fields: readonly string[] }[] = [
  {
    key: 'src/adapters/hosting/agentcore.ts#AgentCoreMemorySessionsOptions',
    fields: ['_client', '_sdk', 'actorId', 'client', 'memoryId', 'region', 'store'],
  },
  {
    key: 'src/adapters/hosting/agentcore.ts#AgentCoreRuntimeHostOptions',
    fields: [
      'allowedHosts',
      'allowedOrigins',
      'busy',
      'conversationPath',
      'hostname',
      'onUnhandled',
      'port',
      'requireJsonContentType',
      'server',
    ],
  },
  {
    key: 'src/adapters/hosting/agentcore.ts#AgentCoreSessionsOptions',
    fields: ['_client', '_sdk', 'actorId', 'client', 'memoryId', 'path', 'region', 'store'],
  },
  {
    key: 'src/adapters/hosting/agentCoreA2A.ts#AgentCoreA2AHostOptions',
    fields: [
      'allowedHosts',
      'allowedOrigins',
      'card',
      'hostname',
      'maxBodyBytes',
      'onUnhandled',
      'port',
      'requireJsonContentType',
      'server',
    ],
  },
  {
    key: 'src/adapters/hosting/foundryResponses.ts#FoundryResponsesHostOptions',
    fields: [
      'allowedHosts',
      'allowedOrigins',
      'hostname',
      'maxBodyBytes',
      'model',
      'onUnhandled',
      'port',
      'requireJsonContentType',
      'server',
    ],
  },
  {
    key: 'src/adapters/memory/agentcore.ts#AgentCoreStoreOptions',
    fields: [
      '_client',
      'client',
      'memoryId',
      'pageSize',
      'region',
      'requireNamespaceScope',
      'sdk',
      'searchAcrossPrincipals',
      'searchNamespace',
      'searchStrategyId',
    ],
  },
  {
    key: 'src/adapters/memory/bedrockAgentMemory.ts#BedrockAgentMemoryOptions',
    fields: ['_client', '_sdk', 'agentAliasId', 'agentId', 'client', 'maxItems', 'region'],
  },
  {
    key: 'src/adapters/memory/pgVector.ts#PgVectorStoreOptions',
    fields: [
      '_client',
      '_pg',
      'batchSize',
      'client',
      'columns',
      'connectionString',
      'feedbackTable',
      'metaTable',
      'schema',
      'signaturesTable',
      'table',
    ],
  },
  {
    key: 'src/adapters/memory/redis.ts#RedisStoreOptions',
    fields: ['_client', 'client', 'prefix', 'scanCount', 'url'],
  },
  {
    key: 'src/adapters/memory/s3Vectors.ts#S3VectorsStoreOptions',
    fields: [
      '_client',
      '_sdk',
      'batchSize',
      'bucket',
      'client',
      'distanceMetric',
      'index',
      'region',
    ],
  },
  {
    key: 'src/adapters/observability/otel.ts#OtelObservabilityOptions',
    fields: [
      '_otelApi',
      'captureContent',
      'captureToolContent',
      'checkAccounting',
      'conversationId',
      'explainability',
      'genAiSpanNames',
      'maxContentChars',
      'onError',
      'sampleRate',
      'scopeName',
      'serviceName',
      'tracer',
    ],
  },
  {
    key: 'src/artifacts/gcsArtifacts.ts#GcsArtifactsOptions',
    fields: ['_now', '_sdk', '_storage', 'bucket', 'prefix', 'projectId', 'retention', 'storage'],
  },
  {
    key: 'src/artifacts/s3Artifacts.ts#S3ArtifactsOptions',
    fields: [
      '_client',
      '_now',
      '_sdk',
      'bucket',
      'client',
      'endpoint',
      'forcePathStyle',
      'prefix',
      'region',
      'retention',
    ],
  },
  {
    key: 'src/embedders/index.ts#BedrockEmbedderOptions',
    fields: [
      '_client',
      '_sdk',
      'client',
      'dimensions',
      'family',
      'inputType',
      'maxInputChars',
      'model',
      'region',
    ],
  },
  {
    key: 'src/hosting/httpHost.ts#HttpHostOptions',
    fields: [
      'allowedHosts',
      'allowedOrigins',
      'capabilities',
      'conversationLimits',
      'conversationPath',
      'healthPath',
      'hostname',
      'invokeHeadProbe',
      'invokePath',
      'maxBodyBytes',
      'name',
      'onUnhandled',
      'port',
      'requireJsonContentType',
      'server',
      'signIn',
      'wire',
    ],
  },
  {
    key: 'src/hosting/nodeHost.ts#NodeHostOptions',
    fields: [
      'allowedHosts',
      'allowedOrigins',
      'conversationLimits',
      'conversationPath',
      'healthPath',
      'hostname',
      'invokePath',
      'maxBodyBytes',
      'onUnhandled',
      'port',
      'requireJsonContentType',
      'server',
      'sessionCookie',
      'sessionHeader',
      'signIn',
    ],
  },
];
