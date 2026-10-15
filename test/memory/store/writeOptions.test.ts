/**
 * Memory write options — vendor-neutral asks, honoured or refused BY NAME.
 *
 *   P1 Unit         — what counts as asked; value checks; the refusal's shape
 *   P2 Boundary     — EVERY shipped store: refuses each option it does not
 *                     honour, before anything is written; empty batch stays a
 *                     no-op; no options → behaviour unchanged
 *   P3 Scenario     — AgentCoreStore through a fake AWS SDK: CreateEvent carries
 *                     `extractionMode: 'SKIP'` / `extractionConfig.namespaceVariables`;
 *                     defineMemory binds them per identity, one tenant each
 *   P4 Property     — no options → no extraction field on the wire, ever; the
 *                     fields sent are exactly the ones asked
 *   P5 Security     — a refusal never quotes a namespace value (it names a tenant)
 *   P6 Performance  — an unhonoured option costs no read: putIfVersion refuses first
 *   P7 ROI          — defineMemory refuses at definition (undeclared store,
 *                     readOnly); a custom client must DECLARE it forwards them
 *
 * Nothing here reaches AWS, Redis, Postgres, S3 or Vertex.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  InMemoryStore,
  MEMORY_WRITE_OPTION_NAMES,
  UnsupportedMemoryWriteOptionError,
  refuseUnhonouredWriteOptions,
  requestedWriteOptions,
  type MemoryStore,
  type MemoryWriteOptions,
  type MemoryNamespaceScope,
  type MemoryWriteOptionsConfig,
} from '../../../src/memory/store/index.js';
import { bindWriteOptions } from '../../../src/memory/store/writeOptions.js';
import { mockEmbedder } from '../../../src/memory/embedding/index.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  AgentCoreStore,
  agentCoreNamespaceValue,
  type AgentCoreLikeClient,
} from '../../../src/adapters/memory/agentcore.js';
import { RedisStore, type RedisLikeClient } from '../../../src/adapters/memory/redis.js';
import { pgVectorStore } from '../../../src/adapters/memory/pgVector.js';
import { s3VectorsStore } from '../../../src/adapters/memory/s3Vectors.js';
import { sqliteVectorStore } from '../../../src/adapters/memory/sqliteVector.js';
import { memoryBankStore } from '../../../src/adapters/memory/memoryBank.js';
import {
  CORPUS_BUNDLE_FORMAT,
  staticVectorStore,
} from '../../../src/memory/store/staticVectorStore.js';
import { fakeSdk, AWS_COMMAND_PINS } from '../../adapters/aws/awsCommandPin.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const IDENTITY: MemoryIdentity = { tenant: 'acme', principal: 'ada', conversationId: 'c-1' };
const TENANT_VALUE = 'tenant-acme-91f3';

function entry(id: string, embedding?: number[]): MemoryEntry {
  const now = Date.now();
  return {
    id,
    value: { id },
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    ...(embedding && { embedding }),
  } as MemoryEntry;
}

/** A proxy any call on which is recorded — so "nothing was written" is checkable. */
function untouchable(): { readonly value: never; readonly touched: string[] } {
  const touched: string[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      return new Proxy(() => undefined, {
        apply() {
          touched.push(String(prop));
          throw new Error(`untouchable: ${String(prop)} was called`);
        },
        get(_f, inner) {
          return inner === 'then' ? undefined : new Proxy(() => undefined, handler);
        },
      });
    },
  };
  return { value: new Proxy({}, handler) as never, touched };
}

const tmp = mkdtempSync(join(tmpdir(), 'af-write-options-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * The SDK's own schema of `CreateEventInput`, laid out as 3.1152.0 ships it —
 * what the store reads to learn that this SDK MODELS the extraction fields.
 */
const CREATE_EVENT_INPUT_SCHEMA = [
  3,
  'com.amazonaws.bedrockagentcore',
  'CreateEventInput',
  0,
  [
    'memoryId',
    'actorId',
    'eventTimestamp',
    'payload',
    'sessionId',
    'branch',
    'clientToken',
    'metadata',
    'extractionMode',
    'extractionConfig',
  ],
];

/**
 * The AgentCore fake SDK, recording every command. `models: false` is an SDK
 * too old to model the extraction fields — its serializer would drop them.
 */
function agentCoreSdk(models = true) {
  const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'AgentCoreStore');
  if (!row) throw new Error('no AgentCoreStore pin');
  const sdk = fakeSdk(row, { ListEventsCommand: { events: [] } });
  return models
    ? { ...sdk, module: { ...sdk.module, CreateEventInput$: CREATE_EVENT_INPUT_SCHEMA } }
    : sdk;
}

/**
 * A store that HONOURS both options and records what each write asked for —
 * the instrument for "every pipeline write carries them". Writes land in the
 * InMemoryStore underneath, without the options it would refuse.
 */
class RecordingStore extends InMemoryStore {
  readonly writeOptions = ['extraction', 'namespaceScope'] as const;
  readonly asked: (MemoryWriteOptions | undefined)[] = [];

  override async put<T = unknown>(
    identity: MemoryIdentity,
    e: MemoryEntry<T>,
    options?: MemoryWriteOptions,
  ): Promise<void> {
    this.asked.push(options);
    return super.put(identity, e);
  }
  override async putMany<T = unknown>(
    identity: MemoryIdentity,
    entries: readonly MemoryEntry<T>[],
    options?: MemoryWriteOptions,
  ): Promise<void> {
    if (entries.length > 0) this.asked.push(options);
    return super.putMany(identity, entries);
  }
  override async putIfVersion<T = unknown>(
    identity: MemoryIdentity,
    e: MemoryEntry<T>,
    expectedVersion: number,
    options?: MemoryWriteOptions,
  ) {
    this.asked.push(options);
    return super.putIfVersion(identity, e, expectedVersion);
  }
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('memory write options — P1 unit', () => {
  it('P1 only fields that ask for something count', () => {
    expect(requestedWriteOptions(undefined)).toEqual([]);
    expect(requestedWriteOptions({})).toEqual([]);
    expect(requestedWriteOptions({ extraction: undefined, namespaceScope: undefined })).toEqual([]);
    // An empty scope names no variable, so it asks for nothing.
    expect(requestedWriteOptions({ namespaceScope: {} })).toEqual([]);
    expect(
      requestedWriteOptions({ extraction: 'skip', namespaceScope: { tenantid: 'acme' } }),
    ).toEqual(['extraction', 'namespaceScope']);
    expect(MEMORY_WRITE_OPTION_NAMES).toEqual(['extraction', 'namespaceScope']);
  });

  it('P1 a value of the wrong shape is a TypeError naming the option', () => {
    expect(() => requestedWriteOptions({ extraction: 'SKIP' as never })).toThrow(/'skip'/);
    expect(() => requestedWriteOptions({ namespaceScope: { tenantid: 7 } as never })).toThrow(
      /namespaceScope/,
    );
    expect(() => requestedWriteOptions({ namespaceScope: ['a'] as never })).toThrow(TypeError);
  });

  it('P1 the refusal carries store, option and code — and reads as a refusal, not a failure', () => {
    let err: unknown;
    try {
      refuseUnhonouredWriteOptions(
        'SomeStore',
        ['extraction'],
        { namespaceScope: { k: 'v' } },
        'why',
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnsupportedMemoryWriteOptionError);
    expect(err).toMatchObject({
      code: 'ERR_UNSUPPORTED_MEMORY_WRITE_OPTION',
      store: 'SomeStore',
      option: 'namespaceScope',
    });
    expect((err as Error).message).toMatch(/refused rather than ignored/);
    // A declared option passes.
    expect(() =>
      refuseUnhonouredWriteOptions('SomeStore', ['extraction'], { extraction: 'skip' }, 'why'),
    ).not.toThrow();
  });
});

// ─── P2 Boundary: every shipped store ────────────────────────────────

describe('memory write options — P2 every shipped store honours or refuses BY NAME', () => {
  const redis = untouchable();
  const pg = untouchable();
  const s3 = untouchable();
  const bank = untouchable();

  /** Each store, with fakes that record any I/O at all. */
  /** For the two stores with no fake to watch, "nothing written" is read back. */
  const readsEmpty = async (s: MemoryStore) => (await s.list(IDENTITY)).entries.length === 0;

  const stores: Record<
    string,
    {
      store: () => MemoryStore;
      touched: () => string[];
      empty?: (s: MemoryStore) => Promise<boolean>;
    }
  > = {
    InMemoryStore: { store: () => new InMemoryStore(), touched: () => [], empty: readsEmpty },
    RedisStore: {
      store: () => new RedisStore({ _client: redis.value as RedisLikeClient }),
      touched: () => redis.touched,
    },
    pgVectorStore: {
      store: () => pgVectorStore({ _client: pg.value }),
      touched: () => pg.touched,
    },
    sqliteVectorStore: {
      store: () => sqliteVectorStore({ file: join(tmp, `refusals-${Math.random()}.db`) }),
      touched: () => [],
      empty: readsEmpty,
    },
    s3VectorsStore: {
      store: () => s3VectorsStore({ bucket: 'b', index: 'i', _client: s3.value, _sdk: s3.value }),
      touched: () => s3.touched,
    },
    MemoryBankStore: {
      store: () =>
        memoryBankStore({
          project: 'p',
          location: 'us-central1',
          reasoningEngine: 'e',
          _client: bank.value,
        }),
      touched: () => bank.touched,
    },
  };

  const ASKS: Record<string, MemoryWriteOptions> = {
    "extraction: 'skip'": { extraction: 'skip' },
    namespaceScope: { namespaceScope: { tenantid: TENANT_VALUE } },
  };

  for (const [name, { store, touched, empty }] of Object.entries(stores)) {
    for (const [label, options] of Object.entries(ASKS)) {
      it(`P2 ${name} refuses ${label} on put / putMany / putIfVersion, writing nothing`, async () => {
        const s = store();
        const option = Object.keys(options)[0];
        const refusal = { name: 'UnsupportedMemoryWriteOptionError', option };
        await expect(s.put(IDENTITY, entry('a', [1, 0]), options)).rejects.toMatchObject(refusal);
        await expect(s.putMany(IDENTITY, [entry('b', [1, 0])], options)).rejects.toMatchObject(
          refusal,
        );
        // putIfVersion: refused by name — or, where the store has no
        // compare-and-set at all, refused for THAT (still never a write).
        await expect(s.putIfVersion(IDENTITY, entry('c', [1, 0]), 0, options)).rejects.toThrow();
        expect(touched()).toEqual([]);
        if (empty !== undefined) expect(await empty(s)).toBe(true);
        // And it declares none, so `defineMemory` refuses before any turn too.
        expect(s.writeOptions ?? []).toEqual([]);
      });
    }

    it(`P2 ${name}: an empty batch stays a no-op, options or not (the port's law)`, async () => {
      await expect(store().putMany(IDENTITY, [], { extraction: 'skip' })).resolves.toBeUndefined();
    });
  }

  it('P2 staticVectorStore refuses every write, with or without options', async () => {
    const s = staticVectorStore({
      format: CORPUS_BUNDLE_FORMAT,
      embedder: { id: 'e', dimensions: 2 },
      namespace: 'corpus',
      exportedAt: 0,
      entries: [],
    });
    await expect(s.put(IDENTITY, entry('a'), { extraction: 'skip' })).rejects.toThrow();
    expect(s.writeOptions).toBeUndefined();
  });

  it('P2 no options: InMemoryStore behaves exactly as before', async () => {
    const s = new InMemoryStore();
    await s.put(IDENTITY, entry('a'));
    await s.putMany(IDENTITY, [entry('b')]);
    expect((await s.putIfVersion(IDENTITY, entry('c'), 0)).applied).toBe(true);
    expect((await s.list(IDENTITY)).entries.map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

// ─── P3 Scenario ─────────────────────────────────────────────────────

describe('memory write options — P3 AgentCoreStore through the SDK', () => {
  it('P3 the options become CreateEvent’s own fields', async () => {
    const sdk = agentCoreSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    expect(store.writeOptions).toEqual(['extraction', 'namespaceScope']);

    await store.put(IDENTITY, entry('a'), {
      extraction: 'skip',
      namespaceScope: { tenantid: TENANT_VALUE },
    });
    // A store that served a scoped write refuses an unscoped one — these go
    // through a store of their own.
    const unscoped = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    await unscoped.putMany(IDENTITY, [entry('b'), entry('c')], { extraction: 'skip' });
    await unscoped.put(IDENTITY, entry('d'));

    const creates = sdk.sent.filter((s) => s.command === 'CreateEventCommand');
    expect(creates).toHaveLength(4);
    expect(creates[0]?.input).toMatchObject({
      extractionMode: 'SKIP',
      extractionConfig: { namespaceVariables: { tenantid: TENANT_VALUE } },
    });
    // The batch: every event of it asked the same thing.
    expect(creates[1]?.input['extractionMode']).toBe('SKIP');
    expect(creates[2]?.input['extractionMode']).toBe('SKIP');
    expect(creates[1]?.input['extractionConfig']).toBeUndefined();
    // No options → no extraction field at all: extracted exactly as before.
    expect('extractionMode' in (creates[3]?.input ?? {})).toBe(false);
    expect('extractionConfig' in (creates[3]?.input ?? {})).toBe(false);
  });

  it('P3 putIfVersion carries them to the write it makes', async () => {
    const sdk = agentCoreSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    const result = await store.putIfVersion(IDENTITY, entry('a'), 0, { extraction: 'skip' });
    expect(result.applied).toBe(true);
    const create = sdk.sent.find((s) => s.command === 'CreateEventCommand');
    expect(create?.input['extractionMode']).toBe('SKIP');
  });

  it('P3 defineMemory binds them to every pipeline write — a namespace per tenant', async () => {
    const sdk = agentCoreSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    const memory = defineMemory({
      id: 'conversation',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store,
      writeOptions: { extraction: 'skip' },
      // One-to-one into AgentCore's alphabet; an absent tenant is refused, not folded.
      namespaceScope: (identity) => ({
        tenantid: agentCoreNamespaceValue(identity.tenant ?? ''),
      }),
    });
    // The definition still carries the caller's own store.
    expect(memory.store).toBe(store);
    expect(memory.write).toBeDefined();

    // And a real agent run writes through it: every event the memory's write
    // subflow creates carries the skip, and each tenant its own namespace.
    const agent = Agent.create({
      provider: mock({ reply: 'noted' }),
      model: 'mock',
      maxIterations: 1,
    })
      .system('You remember.')
      .memory(memory)
      .build();
    await agent.run({ message: 'remember this', identity: { ...IDENTITY, tenant: 'acme' } });
    await agent.run({ message: 'and this', identity: { ...IDENTITY, tenant: 'globex' } });
    const creates = sdk.sent.filter((s) => s.command === 'CreateEventCommand');
    expect(creates.length).toBeGreaterThanOrEqual(2);
    expect(creates.every((c) => c.input['extractionMode'] === 'SKIP')).toBe(true);
    const scopes = creates.map(
      (c) =>
        (c.input['extractionConfig'] as { namespaceVariables: { tenantid: string } })
          .namespaceVariables.tenantid,
    );
    expect(new Set(scopes)).toEqual(new Set(['vacme_z', 'vglobex_z']));
    // Each tenant's events went to that tenant's actor — the two never mix.
    for (const c of creates) {
      const tenant = (c.input['extractionConfig'] as { namespaceVariables: { tenantid: string } })
        .namespaceVariables.tenantid;
      expect(String(c.input['actorId'])).toContain(tenant.slice(1, -2));
    }
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('memory write options — P4 property (every combination of every field state)', () => {
  // The whole domain, not a sample: each field absent, explicitly undefined, or
  // each value it can take — so "exactly the fields asked" is checked everywhere.
  const EXTRACTION = [{}, { extraction: undefined }, { extraction: 'skip' as const }];
  const SCOPE = [
    {},
    { namespaceScope: undefined },
    { namespaceScope: {} },
    { namespaceScope: { tenantid: 'a' } },
    { namespaceScope: { tenantid: 'a', regionid: 'eu' } },
  ];
  const CASES: (MemoryWriteOptions | undefined)[] = [
    undefined,
    ...EXTRACTION.flatMap((e) => SCOPE.map((sc) => ({ ...e, ...sc } as MemoryWriteOptions))),
  ];

  it.each(CASES.map((c) => [JSON.stringify(c ?? null), c] as const))(
    'P4 %s → exactly the fields asked, and nothing else',
    async (_label, options) => {
      const sdk = agentCoreSdk();
      const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
      await store.put(IDENTITY, entry('a'), options);
      const input = sdk.sent[0]?.input ?? {};
      const asked = requestedWriteOptions(options);
      expect('extractionMode' in input).toBe(asked.includes('extraction'));
      expect('extractionConfig' in input).toBe(asked.includes('namespaceScope'));
      if (asked.includes('namespaceScope')) {
        expect(input['extractionConfig']).toEqual({ namespaceVariables: options?.namespaceScope });
      }
    },
  );

  it('P4 agentCoreNamespaceValue is one-to-one, and always in AgentCore’s alphabet', () => {
    // The pairs a lossy mapping folds: case, punctuation, the escape itself,
    // a value that looks escaped, an astral character, and a lone surrogate.
    const inputs = [
      'acme',
      'Acme',
      'ACME',
      'a.b',
      'ab',
      'a/b',
      'a_b',
      'a-b',
      'a b',
      '_',
      '-',
      '0',
      'v',
      'vacme',
      '_0041cme',
      'Ünïcode',
      '😀',
      '\ud800',
      'none',
      '1',
      '12',
      'acme-eu',
      'x'.repeat(61),
    ];
    const outputs = inputs.map((raw) => agentCoreNamespaceValue(raw));
    expect(new Set(outputs).size).toBe(inputs.length);
    for (const out of outputs) expect(out).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/);
    // Prefix-free: no tenant's value is the beginning of another's — so a
    // prefix match over namespaces (AgentCore's `namespace` filter) cannot
    // reach a neighbour ('1' vs '12', 'acme' vs 'acme-eu').
    for (const a of outputs) {
      for (const b of outputs)
        if (a !== b) expect(b.startsWith(a), `${a} prefixes ${b}`).toBe(false);
    }
    expect(agentCoreNamespaceValue('acme')).toBe('vacme_z');
    expect(agentCoreNamespaceValue('Acme')).toBe('v_0041cme_z');
    // Refused, never folded: an absent tenant, and one too long to fit.
    expect(() => agentCoreNamespaceValue('')).toThrow(TypeError);
    expect(() => agentCoreNamespaceValue('x'.repeat(62))).toThrow(RangeError);
  });
});

// ─── P5 Security ─────────────────────────────────────────────────────

describe('memory write options — P5 security', () => {
  it('P5 a refusal names the store and the option, never the tenant value', async () => {
    let message = '';
    try {
      await new InMemoryStore().put(IDENTITY, entry('a'), {
        namespaceScope: { tenantid: TENANT_VALUE },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('InMemoryStore');
    expect(message).toContain('namespaceScope');
    expect(message).not.toContain(TENANT_VALUE);
  });

  it('P5 a malformed scope is refused without echoing it', () => {
    let message = '';
    try {
      requestedWriteOptions({ namespaceScope: { tenantid: { secret: TENANT_VALUE } } as never });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/not quoted/);
    expect(message).not.toContain(TENANT_VALUE);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('memory write options — P6 performance', () => {
  it('P6 an unhonoured option costs no read — putIfVersion refuses before it lists', async () => {
    const calls: string[] = [];
    const client: AgentCoreLikeClient = {
      // No `forwardsWriteOptions`: this client may drop the fields.
      createEvent: async () => void calls.push('createEvent'),
      listEvents: async () => (calls.push('listEvents'), { events: [] }),
      deleteEvent: async () => void calls.push('deleteEvent'),
    };
    const store = new AgentCoreStore({ memoryId: 'mem-1', client });
    await expect(
      store.putIfVersion(IDENTITY, entry('a'), 0, { extraction: 'skip' }),
    ).rejects.toBeInstanceOf(UnsupportedMemoryWriteOptionError);
    expect(calls).toEqual([]);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('memory write options — P7 ROI', () => {
  it('P7 defineMemory refuses an option the store does not declare — before any turn', () => {
    expect(() =>
      defineMemory({
        id: 'm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
        writeOptions: { extraction: 'skip' },
      }),
    ).toThrow(UnsupportedMemoryWriteOptionError);
  });

  it('P7 defineMemory refuses writeOptions on a read-only memory', () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: agentCoreSdk().module });
    expect(() =>
      defineMemory({
        id: 'm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store,
        readOnly: true,
        writeOptions: { extraction: 'skip' },
      }),
    ).toThrow(/readOnly/);
  });

  it('P7 a custom client must DECLARE it forwards them — undeclared, the store honours none', async () => {
    const created: unknown[] = [];
    const legacy: AgentCoreLikeClient = {
      createEvent: async (input) => void created.push(input),
      listEvents: async () => ({ events: [] }),
      deleteEvent: async () => undefined,
    };
    const undeclared = new AgentCoreStore({ memoryId: 'mem-1', client: legacy });
    expect(undeclared.writeOptions).toBeUndefined();
    await expect(
      undeclared.put(IDENTITY, entry('a'), { namespaceScope: { tenantid: 'x' } }),
    ).rejects.toMatchObject({ option: 'namespaceScope' });
    expect(created).toEqual([]);

    const declared = new AgentCoreStore({
      memoryId: 'mem-1',
      client: { ...legacy, forwardsWriteOptions: true },
    });
    await declared.put(IDENTITY, entry('b'), { extraction: 'skip' });
    expect(created).toHaveLength(1);
    expect((created[0] as { extractionMode?: string }).extractionMode).toBe('SKIP');
  });
});

// ─── P2/P5 AgentCore: what can never reach the service ──────────────

describe('memory write options — AgentCore refuses what could not reach AgentCore intact', () => {
  it('an SDK too old to MODEL the fields: the store declares none and refuses by name', async () => {
    const sdk = agentCoreSdk(false);
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    // Its serializer would drop both fields without a word — so neither is declared...
    expect(store.writeOptions).toBeUndefined();
    // ...and a write that asks is refused, naming the fix, before anything is sent.
    await expect(store.put(IDENTITY, entry('a'), { extraction: 'skip' })).rejects.toThrow(
      /does not model CreateEvent's `extractionMode`.*Upgrade the SDK/s,
    );
    expect(sdk.sent).toEqual([]);
    // defineMemory says so before any turn runs.
    expect(() =>
      defineMemory({
        id: 'm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store,
        writeOptions: { extraction: 'skip' },
      }),
    ).toThrow(UnsupportedMemoryWriteOptionError);
  });

  it('namespace variables outside AgentCore’s domain are refused by rule, never quoted', async () => {
    const sdk = agentCoreSdk();
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: sdk.module });
    const refusal = async (scope: Record<string, string>) => {
      try {
        await store.put(IDENTITY, entry('a'), { namespaceScope: scope });
      } catch (err) {
        return (err as Error).message;
      }
      return 'no refusal';
    };
    const upper = await refusal({ tenantid: 'Tenant-ACME-Secret' });
    expect(upper).toMatch(/not one AgentCore admits/);
    expect(upper).not.toContain('Tenant-ACME-Secret');
    expect(await refusal({ TenantId: 'acme' })).toMatch(/variable name "TenantId"/);
    expect(await refusal({ a: 'x', b: 'x', c: 'x', d: 'x', e: 'x', f: 'x' })).toMatch(/at most 5/);
    expect(await refusal({ tenantid: 'x'.repeat(65) })).toMatch(/1–64 characters/);
    // None of them reached the service.
    expect(sdk.sent).toEqual([]);
    // The encoder's output is always admitted.
    await store.put(IDENTITY, entry('b'), {
      namespaceScope: { tenantid: agentCoreNamespaceValue('Tenant-ACME') },
    });
    expect(sdk.sent).toHaveLength(1);
  });

  it('a refusal for a custom client names ITS fix — no contradictory advice', async () => {
    const client: AgentCoreLikeClient = {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [] }),
      deleteEvent: async () => undefined,
    };
    const store = new AgentCoreStore({ memoryId: 'mem-1', client });
    let message = '';
    try {
      await store.put(IDENTITY, entry('a'), { extraction: 'skip' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Declare it on the client/);
    expect(message).not.toMatch(/leave the option off/);
  });

  it('a wrapper made by spreading the store does not inherit the declaration', () => {
    const store = new AgentCoreStore({ memoryId: 'mem-1', _sdk: agentCoreSdk().module });
    expect(store.writeOptions).toEqual(['extraction', 'namespaceScope']);
    // `{ ...store, put }` copies own fields only — and a wrapper that does not
    // forward the third argument must not claim to honour it.
    const wrapped = { ...store } as unknown as MemoryStore;
    expect(wrapped.writeOptions).toBeUndefined();
  });
});

// ─── P2 The bound store (`defineMemory({ writeOptions })`) ───────────

describe('memory write options — the store defineMemory binds', () => {
  const memoryOf = (
    store: MemoryStore,
    {
      extraction,
      namespaceScope,
    }: MemoryWriteOptionsConfig & { namespaceScope?: MemoryNamespaceScope },
  ) =>
    defineMemory({
      id: 'm',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store,
      ...(extraction !== undefined && { writeOptions: { extraction } }),
      ...(namespaceScope !== undefined && { namespaceScope }),
    });

  /** Run one turn through an agent holding `memory`; return what the store recorded. */
  async function oneTurn(memory: ReturnType<typeof defineMemory>, message = 'hi') {
    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 1 })
      .system('s')
      .memory(memory)
      .build();
    await agent.run({ message, identity: IDENTITY });
  }

  it('a scope function that returns nothing usable REFUSES the write instead of sending it bare', async () => {
    for (const bad of [() => ({}), () => undefined, () => new Map(), () => Promise.resolve({})]) {
      const store = new RecordingStore();
      const memory = memoryOf(store, {
        namespaceScope: bad as unknown as () => Record<string, string>,
      });
      await expect(oneTurn(memory)).rejects.toThrow(/namespaceScope/);
      expect(store.asked).toEqual([]);
    }
  });

  it('a refused scope is a REJECTED promise from every bound write — never a synchronous throw', async () => {
    const store = new RecordingStore();
    const bound = bindWriteOptions(store, {
      namespaceScope: () => ({} as Record<string, string>),
    });
    const writes = [
      () => bound.put(IDENTITY, entry('a')),
      () => bound.putMany(IDENTITY, [entry('b')]),
      () => bound.putIfVersion(IDENTITY, entry('c'), 0),
    ];
    for (const write of writes) {
      let pending: Promise<unknown> | undefined;
      expect(() => {
        pending = write();
      }).not.toThrow();
      await expect(pending).rejects.toThrow(/namespaceScope/);
    }
    expect(store.asked).toEqual([]);
  });

  it('a fixed scope that is empty or malformed is refused at definition', () => {
    const store = new RecordingStore();
    expect(() => memoryOf(store, { namespaceScope: {} })).toThrow(/EMPTY/);
    expect(() =>
      memoryOf(store, { namespaceScope: { tenantid: 7 } as unknown as Record<string, string> }),
    ).toThrow(/plain object of string values/);
  });

  it('a call’s own undefined or empty option never erases what the memory was bound with', async () => {
    const store = new RecordingStore();
    // Reach the bound store the way a pipeline stage does — through the memory's write.
    const memory = memoryOf(store, { extraction: 'skip', namespaceScope: { tenantid: 'acme' } });
    await oneTurn(memory);
    expect(store.asked.length).toBeGreaterThan(0);
    for (const asked of store.asked) {
      expect(asked).toEqual({ extraction: 'skip', namespaceScope: { tenantid: 'acme' } });
    }
  });

  it('declarations, reads and search pass straight through', async () => {
    const plain = new RecordingStore();
    const memory = memoryOf(plain, { extraction: 'skip' });
    // The definition keeps the caller's own store; the pipeline gets the bound one.
    expect(memory.store).toBe(plain);
    await oneTurn(memory, 'remember the blue door');
    // Reads through the bound store see what was written through it.
    const listed = await plain.list(IDENTITY);
    expect(listed.entries.length).toBeGreaterThan(0);
    // A second turn READS the first one back through the bound store.
    await oneTurn(memory, 'and now?');
    expect(plain.asked.every((a) => a?.extraction === 'skip')).toBe(true);
  });

  it('SEMANTIC (TOP_K over a store with search), and fact / beat extraction all write with them', async () => {
    const cases = [
      {
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, embedder: mockEmbedder() },
        store: () => new RecordingStore({ embedder: mockEmbedder() }),
      },
      {
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' as const },
        store: () => new RecordingStore(),
      },
      {
        type: MEMORY_TYPES.NARRATIVE,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' as const },
        store: () => new RecordingStore(),
      },
    ];
    for (const c of cases) {
      const store = c.store();
      const memory = defineMemory({
        id: 'm',
        type: c.type,
        strategy: c.strategy,
        store,
        writeOptions: { extraction: 'skip' },
        namespaceScope: { tenantid: 'acme' },
      } as Parameters<typeof defineMemory>[0]);
      await oneTurn(memory, 'My name is Ada and I prefer email. We decided to ship on Friday.');
      await oneTurn(memory, 'What do you remember?');
      expect(store.asked.length, `${c.type}/${c.strategy.kind} wrote nothing`).toBeGreaterThan(0);
      for (const asked of store.asked) {
        expect(asked).toEqual({ extraction: 'skip', namespaceScope: { tenantid: 'acme' } });
      }
    }
  });
});

// ─── P5 Security: search reads only its own namespace ───────────────

describe('memory write options — search never reads a neighbouring namespace', () => {
  it('a prefix match is narrowed to the namespace asked for, on whole path segments', async () => {
    const asked: string[] = [];
    const client: AgentCoreLikeClient = {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [] }),
      deleteEvent: async () => undefined,
      // AgentCore's documented behaviour: every record whose namespace STARTS
      // WITH the requested prefix.
      retrieveRecords: async ({ namespace }) => {
        asked.push(namespace);
        const all = [
          {
            memoryRecordId: 'mine',
            content: 'tenant 1 fact',
            score: 0.9,
            namespaces: ['/tenants/v1/facts'],
          },
          {
            memoryRecordId: 'mine-root',
            content: 'tenant 1 root',
            score: 0.8,
            namespaces: ['/tenants/v1/'],
          },
          {
            memoryRecordId: 'neighbour',
            content: 'tenant 12 fact',
            score: 0.95,
            namespaces: ['/tenants/v12/facts'],
          },
          { memoryRecordId: 'unfiled', content: 'no namespace reported', score: 0.99 },
        ];
        return {
          records: all.filter((r) => (r.namespaces ?? ['']).some((n) => n.startsWith(namespace))),
        };
      },
    };
    const store = new AgentCoreStore({
      memoryId: 'mem-1',
      client,
      searchNamespace: ({ identity }) => `/tenants/v${identity.tenant ?? ''}`,
    });
    const found = await store.search({ tenant: '1', conversationId: 'c' }, [0], { text: 'facts?' });
    expect(asked).toEqual(['/tenants/v1']);
    // Tenant 12's record matched AgentCore's prefix — and is not handed to tenant 1.
    expect(found.map((f) => f.entry.id).sort()).toEqual(['mine', 'mine-root']);
  });

  /** A client that files records where told and answers as AgentCore does: by prefix. */
  function prefixClient() {
    const asked: string[] = [];
    const filed: {
      memoryRecordId: string;
      content: string;
      score: number;
      namespaces: string[];
    }[] = [];
    const client: AgentCoreLikeClient = {
      createEvent: async () => undefined,
      listEvents: async () => ({ events: [] }),
      deleteEvent: async () => undefined,
      retrieveRecords: async ({ namespace }) => {
        asked.push(namespace);
        return { records: filed.filter((r) => r.namespaces.some((n) => n.startsWith(namespace))) };
      },
    };
    return { client, asked, filed };
  }

  it('an actor whose id EXTENDS another’s is never served to it (bob@x.com / bob@x.com.au)', async () => {
    const { client, asked, filed } = prefixClient();
    const store = new AgentCoreStore({
      memoryId: 'mem-1',
      client,
      // The documented shape that ends at the actor.
      searchNamespace: ({ actorId }) => `/strategies/semantic/actors/${actorId}`,
    });
    const bob: MemoryIdentity = { tenant: 't', principal: 'bob@x.com', conversationId: 'c' };
    const bobAu: MemoryIdentity = { tenant: 't', principal: 'bob@x.com.au', conversationId: 'c' };
    // Where each actor's records are filed: the namespace each one searches.
    await store.search(bob, [0], { text: 'q' });
    await store.search(bobAu, [0], { text: 'q' });
    const [bobNs = '', auNs = ''] = asked;
    // The precondition: one actor's namespace is a WHOLE-SEGMENT prefix of the other's.
    expect(auNs.startsWith(`${bobNs}/`)).toBe(true);
    filed.push(
      { memoryRecordId: 'bob', content: 'bob', score: 0.5, namespaces: [bobNs] },
      {
        memoryRecordId: 'bob-s',
        content: 'bob s',
        score: 0.4,
        namespaces: [`${bobNs}/sessions/c`],
      },
      { memoryRecordId: 'au', content: 'au', score: 0.9, namespaces: [auNs] },
      { memoryRecordId: 'au-s', content: 'au s', score: 0.8, namespaces: [`${auNs}/sessions/c`] },
    );
    const forBob = await store.search(bob, [0], { text: 'q' });
    const forAu = await store.search(bobAu, [0], { text: 'q' });
    // AgentCore handed bob all four; only his own two reach him.
    expect(forBob.map((f) => f.entry.id).sort()).toEqual(['bob', 'bob-s']);
    expect(forAu.map((f) => f.entry.id).sort()).toEqual(['au', 'au-s']);
  });

  it('a `*` in the namespace is refused by name — a wildcard cannot be checked for ownership', async () => {
    const { client, asked } = prefixClient();
    const store = new AgentCoreStore({
      memoryId: 'mem-1',
      client,
      searchNamespace: () => '/strategies/*/actors',
    });
    await expect(store.search({ conversationId: 'c' }, [0], { text: 'q' })).rejects.toThrow(
      /containing `\*`/,
    );
    // Refused before anything was asked.
    expect(asked).toEqual([]);
  });

  it('the built-in client reads the SDK’s `namespaces` array', async () => {
    const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'AgentCoreStore');
    if (!row) throw new Error('no AgentCoreStore pin');
    const sdk = fakeSdk(row, {
      RetrieveMemoryRecordsCommand: {
        memoryRecordSummaries: [
          {
            memoryRecordId: 'r-1',
            content: { text: 'ok' },
            score: 0.5,
            namespaces: ['/actors/a/sessions/s'],
          },
          {
            memoryRecordId: 'r-2',
            content: { text: 'other' },
            score: 0.6,
            namespaces: ['/actors/a/sessions/s2'],
          },
        ],
      },
    });
    const store = new AgentCoreStore({
      memoryId: 'mem-1',
      _sdk: sdk.module,
      searchNamespace: () => '/actors/a/sessions/s',
      // This case is about the SDK's `namespaces` field, not about actors.
      searchAcrossPrincipals: true,
    });
    const found = await store.search(IDENTITY, [0], { text: 'q' });
    expect(found.map((f) => f.entry.id)).toEqual(['r-1']);
    expect(found[0]?.entry.metadata).toMatchObject({ namespace: '/actors/a/sessions/s' });
  });
});
