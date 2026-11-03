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

export {
  constructionBehaviorKeys,
  constructionSourceExclusions,
  constructionOptionShapes,
} from './sourceCoverageRegistry.js';
