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
} from '../../../src/memory/store/index.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import { Agent } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import {
  AgentCoreStore,
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

/** The AgentCore fake SDK, recording every command. */
function agentCoreSdk() {
  const row = AWS_COMMAND_PINS.find((p) => p.adapter === 'AgentCoreStore');
  if (!row) throw new Error('no AgentCoreStore pin');
  return fakeSdk(row, { ListEventsCommand: { events: [] } });
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
  const stores: Record<string, { store: () => MemoryStore; touched: () => string[] }> = {
    InMemoryStore: { store: () => new InMemoryStore(), touched: () => [] },
    RedisStore: {
      store: () => new RedisStore({ _client: redis.value as RedisLikeClient }),
      touched: () => redis.touched,
    },
    pgVectorStore: {
      store: () => pgVectorStore({ _client: pg.value }),
      touched: () => pg.touched,
    },
    sqliteVectorStore: {
      store: () => sqliteVectorStore({ file: join(tmp, 'refusals.db') }),
      touched: () => [],
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

  for (const [name, { store, touched }] of Object.entries(stores)) {
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
    await store.putMany(IDENTITY, [entry('b'), entry('c')], { extraction: 'skip' });
    await store.put(IDENTITY, entry('d'));

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
      writeOptions: {
        extraction: 'skip',
        namespaceScope: (identity) => ({ tenantid: `t-${identity.tenant ?? 'none'}` }),
      },
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
    expect(new Set(scopes)).toEqual(new Set(['t-acme', 't-globex']));
    // Each tenant's events went to that tenant's actor — the two never mix.
    for (const c of creates) {
      const tenant = (c.input['extractionConfig'] as { namespaceVariables: { tenantid: string } })
        .namespaceVariables.tenantid;
      expect(String(c.input['actorId'])).toContain(tenant.slice(2));
    }
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('memory write options — P4 property', () => {
  const CASES: readonly (MemoryWriteOptions | undefined)[] = [
    undefined,
    {},
    { extraction: 'skip' },
    { namespaceScope: { tenantid: 'a' } },
    { namespaceScope: {} },
    { extraction: 'skip', namespaceScope: { tenantid: 'a', regionid: 'eu' } },
    { extraction: undefined, namespaceScope: undefined },
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
