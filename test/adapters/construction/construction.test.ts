import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lazyRequire } from '../../../src/lib/lazyRequire.js';
import { constructionRegistry, PRIVATE_VALUE, type Options } from './registry.js';
import { makeCapture, envelope } from '../../helpers/otelCapture.js';
import { otelObservability } from '../../../src/adapters/observability/otel.js';
import {
  agentCoreEvaluationSpans,
  AGENTCORE_EVALUATIONS_SCOPE_NAME,
} from '../../../src/adapters/observability/agentcore.js';
import { bedrockEmbedder } from '../../../src/embedders/index.js';
import { firestoreSessions } from '../../../src/adapters/hosting/firestoreSessions.js';
import { mcpClient } from '../../../src/mcp/mcpClient.js';

vi.mock('../../../src/lib/lazyRequire.js', () => ({
  lazyRequire: vi.fn(() => {
    throw new Error('UNEXPECTED_OPTIONAL_SDK_LOAD');
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(lazyRequire).mockClear();
});

function capture(create: () => unknown): unknown {
  try {
    create();
    return undefined;
  } catch (error) {
    return error;
  }
}

function assertClosedError(error: unknown, adapter: string, reason = 'conflicting-options'): void {
  expect(error, 'construction must refuse synchronously').toBeInstanceOf(Error);
  expect(error).toMatchObject({
    name: 'AdapterConfigurationError',
    code: 'ERR_ADAPTER_CONFIGURATION',
    reason,
    adapter,
  });
  expect(error).not.toHaveProperty('cause');
  const own = Object.getOwnPropertyDescriptors(error);
  expect(
    Object.keys(own).filter(
      (key) => !['stack', 'message', 'name', 'code', 'reason', 'adapter'].includes(key),
    ),
  ).toEqual([]);
  // inspect(showHidden) includes non-enumerable own fields and nested retained values.
  expect(inspect(error, { showHidden: true, depth: 10 })).not.toContain(PRIVATE_VALUE);
  expect(JSON.stringify(error)).not.toContain(PRIVATE_VALUE);
}

for (const item of constructionRegistry) {
  describe(`construction law: ${item.entry}`, () => {
    for (const field of item.fields) {
      for (const [index, value] of field.values.entries()) {
        it(`refuses ${field.key} variant ${index} before SDK/client/listener/timer work`, () => {
          const fixture = item.fixture();
          const timeout = vi.spyOn(globalThis, 'setTimeout');
          const interval = vi.spyOn(globalThis, 'setInterval');
          const failure = capture(() => item.create({ ...fixture.options, [field.key]: value }));
          assertClosedError(failure, item.adapter);
          expect(fixture.effects).toEqual([]);
          expect(lazyRequire).not.toHaveBeenCalled();
          expect(timeout).not.toHaveBeenCalled();
          expect(interval).not.toHaveBeenCalled();
        });
      }

      if (item.privateKey) {
        it(`still refuses public ${field.key} when a private override is also supplied`, () => {
          const fixture = item.fixture();
          const failure = capture(() =>
            item.create({
              ...fixture.options,
              [item.privateKey!]: fixture.handle,
              [field.key]: field.values[0],
            }),
          );
          assertClosedError(failure, item.adapter);
          expect(fixture.effects).toEqual([]);
          expect(lazyRequire).not.toHaveBeenCalled();
        });
      }
    }

    if (!item.implicitConflict) {
      it('accepts a borrowed handle with explicit undefined construction fields and operational settings', () => {
        const fixture = item.fixture();
        const options = { ...fixture.options };
        for (const field of item.fields) options[field.key] = undefined;
        expect(() => item.create(options)).not.toThrow();
        expect(lazyRequire).not.toHaveBeenCalled();
        expect(fixture.effects).not.toContain('client-construction');
        expect(fixture.effects).not.toContain('listener');
      });
    }

    if (item.privateKey) {
      const privateKey = item.privateKey;
      it('preserves private-only test override semantics', () => {
        const fixture = item.fixture();
        const options: Options = { ...fixture.options, [privateKey]: fixture.handle };
        delete options[item.handleKey];
        for (const field of item.fields) options[field.key] = field.values[0];
        expect(() => item.create(options)).not.toThrow();
        expect(lazyRequire).not.toHaveBeenCalled();
      });
    }
  });
}

it('uses the same captured client for validation, execution and borrowed ownership', async () => {
  const item = constructionRegistry.find((entry) => entry.entry === 'RedisStore')!;
  const fixture = item.fixture();
  let reads = 0;
  const wrongClient = {
    get: () => {
      throw new Error('WRONG_CLIENT_SELECTED');
    },
  };
  const options: Options = { ...fixture.options };
  Object.defineProperty(options, 'client', {
    get: () => (++reads === 1 ? fixture.handle : wrongClient),
    enumerable: true,
  });
  const store = item.create(options) as {
    get(identity: object, id: string): Promise<unknown>;
    close(): Promise<void>;
  };
  let operationFailure: unknown;
  let value: unknown;
  try {
    value = await store.get({ conversationId: 'contract' }, 'missing');
    await store.close();
  } catch (error) {
    operationFailure = error;
  }
  expect(operationFailure, 'the captured client must remain the selected client').toBeUndefined();
  expect(value).toBeNull();
  expect(reads).toBe(1);
  expect(fixture.effects).not.toContain('borrowed-quit');
});

for (const entry of ['s3Artifacts', 'gcsArtifacts']) {
  it(`${entry} sanitizes an owned SDK constructor failure through the shared error`, () => {
    const item = constructionRegistry.find((candidate) => candidate.entry === entry)!;
    const fixture = item.fixture();
    const options = { ...fixture.options };
    delete options[item.handleKey];
    const Constructor = class {
      constructor() {
        throw new Error(PRIVATE_VALUE);
      }
    };
    options._sdk = entry === 's3Artifacts' ? { S3Client: Constructor } : { Storage: Constructor };
    const failure = capture(() => item.create(options));
    assertClosedError(failure, item.adapter, 'client-construction-failed');
    expect(lazyRequire).not.toHaveBeenCalled();
  });
}

it('keeps resource IDs and request limits active with borrowed memory/session clients', async () => {
  const memory = constructionRegistry.find((entry) => entry.entry === 'BedrockAgentMemory')!;
  const memoryFixture = memory.fixture();
  const sent: unknown[] = [];
  const reader = memory.create({
    ...memoryFixture.options,
    maxItems: 3,
    client: {
      getSessionSummaries: async (input: unknown) => {
        sent.push(input);
        return { summaries: [] };
      },
    },
  }) as { readSummaries(memoryId: string): Promise<unknown> };
  await reader.readSummaries('subject');
  expect(sent).toEqual([
    { agentId: 'agent', agentAliasId: 'alias', memoryId: 'subject', maxItems: 3 },
  ]);

  const sessions = constructionRegistry.find((entry) => entry.entry === 'agentCoreSessions')!;
  const sessionFixture = sessions.fixture();
  const lifecycle = sessions.create({
    ...sessionFixture.options,
    client: {
      listEvents: async (input: unknown) => {
        sent.push(input);
        return { events: [] };
      },
    },
  }) as { hydrate(sessionId: string): Promise<unknown> };
  expect(await lifecycle.hydrate('thread')).toBeUndefined();
  expect(sent[1]).toMatchObject({ memoryId: 'memory', actorId: 'actor', maxResults: 1 });
  expect(lazyRequire).not.toHaveBeenCalled();
});

it('keeps an owned embedder lazy and uses the same captured region at first dispatch', async () => {
  const configs: unknown[] = [];
  let regionReads = 0;
  let clientReads = 0;
  const options: Parameters<typeof bedrockEmbedder>[0] = {
    get client() {
      clientReads++;
      return undefined;
    },
    get region() {
      return ++regionReads === 1 ? 'captured-region' : 'wrong-region';
    },
    dimensions: 256,
    _sdk: {
      BedrockRuntimeClient: class {
        constructor(config: unknown) {
          configs.push(config);
        }
        async send(): Promise<unknown> {
          return { body: JSON.stringify({ embedding: [0.1, 0.2] }) };
        }
      },
      InvokeModelCommand: class {
        constructor(readonly input: unknown) {}
      },
    },
  };
  const embedder = bedrockEmbedder(options);
  expect(configs).toEqual([]);
  expect(await embedder.embed({ text: 'contract' })).toEqual([0.1, 0.2]);
  expect(configs).toEqual([{ region: 'captured-region' }]);
  expect(regionReads).toBe(1);
  expect(clientReads).toBe(1);
  expect(lazyRequire).not.toHaveBeenCalled();
});

it('keeps injected-tracer service/content controls active without trying to rename it', () => {
  const capture = makeCapture();
  const errors: Error[] = [];
  const strategy = otelObservability({
    serviceName: 'operational-service',
    tracer: capture.tracer,
    _otelApi: capture.otelApi,
    captureContent: false,
    captureToolContent: false,
    onError: (error) => errors.push(error),
  });
  strategy.exportEvent(envelope('agentfootprint.agent.turn_start', { userPrompt: PRIVATE_VALUE }));
  strategy.exportEvent(envelope('agentfootprint.agent.turn_end', { finalContent: PRIVATE_VALUE }));
  expect(capture.spans).toHaveLength(1);
  expect(capture.spans[0]?.attributes['service.name']).toBe('operational-service');
  expect(inspect(capture.spans)).not.toContain(PRIVATE_VALUE);
  expect(errors).toEqual([]);
});

it('acquires the required Evaluation scope from an owned tracer lazily', () => {
  const capture = makeCapture();
  const scopes: string[] = [];
  const strategy = agentCoreEvaluationSpans({
    serviceName: 'evaluations',
    captureContent: false,
    captureToolContent: false,
    _otelApi: {
      ...capture.otelApi,
      trace: {
        ...capture.otelApi.trace,
        getTracer: (scope: string) => {
          scopes.push(scope);
          return capture.tracer;
        },
      },
    },
  });
  expect(scopes).toEqual([]);
  strategy.exportEvent(envelope('agentfootprint.agent.turn_start', {}));
  strategy.exportEvent(envelope('agentfootprint.agent.turn_end', {}));
  expect(scopes).toEqual([AGENTCORE_EVALUATIONS_SCOPE_NAME]);
  expect(capture.spans).toHaveLength(1);
  expect(lazyRequire).not.toHaveBeenCalled();
});

it('preserves the pre-existing Firestore and MCP construction refusal shapes', async () => {
  const firestoreFailure = capture(() =>
    firestoreSessions({
      firestore: {} as NonNullable<Parameters<typeof firestoreSessions>[0]>['firestore'],
      project: 'project',
    }),
  );
  expect(firestoreFailure).toBeInstanceOf(TypeError);
  expect(firestoreFailure).not.toHaveProperty('code', 'ERR_ADAPTER_CONFIGURATION');
  const mcpFailure: unknown = await mcpClient({
    connection: {
      listTools: async () => ({ tools: [] }),
      callTool: async () => ({ content: [] }),
      close: async () => {},
    },
    clientInfo: { name: 'client', version: '1' },
  } as unknown as Parameters<typeof mcpClient>[0]).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(mcpFailure).toBeInstanceOf(Error);
  expect(mcpFailure).not.toHaveProperty('code', 'ERR_ADAPTER_CONFIGURATION');
  expect(String(mcpFailure)).toMatch(/connection.*clientInfo/);
  expect(lazyRequire).not.toHaveBeenCalled();
});
