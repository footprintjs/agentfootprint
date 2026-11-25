/** Scripted invocation boundaries only: these tests make no extraction or wire-attempt claim. */
import { describe, expect, it, vi } from 'vitest';
import {
  body,
  clientFixture,
  clientStore,
  entry,
  identity,
  neighbour,
  sdkFixture,
  sdkStore,
} from './agentcore-event-payload.fixtures.js';
import type { Choice } from './agentcore-event-payload.fixtures.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';

const conversation = (text = 'selected text', role = 'user' as const): Choice => ({
  kind: 'conversational',
  role,
  text,
});
const withoutTimestamp = (input: Record<string, unknown>) => ({
  ...input,
  eventTimestamp: '<timestamp>',
});

describe('AgentCore event payload — one body, explicit caller projection', () => {
  it('omitted and explicit blob selectors preserve the entire default request body', async () => {
    const omitted = sdkFixture();
    const explicit = sdkFixture();
    const select = vi.fn((): Choice => ({ kind: 'blob' }));
    const value = entry();
    await sdkStore(omitted).put(identity, value);
    await sdkStore(explicit, select).put(identity, value);
    expect(omitted.send).toHaveBeenCalledOnce();
    expect(explicit.send).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledOnce();
    expect(omitted.creates()[0].input).toEqual({
      ...body(value),
      eventTimestamp: expect.any(Date),
    });
    expect(withoutTimestamp(explicit.creates()[0].input)).toEqual(
      withoutTimestamp(omitted.creates()[0].input),
    );
    expect(await sdkStore(omitted).get(identity, value.id)).toEqual(value);
  });

  it.each(['user', 'assistant', 'tool', 'other'] as const)(
    'adds exactly one %s conversation beside the unchanged all-field canonical blob',
    async (role) => {
      const fixture = sdkFixture();
      const value = entry();
      const choice: Choice = { kind: 'conversational', role, text: 'Exact\n選択😀 text' };
      const select = vi.fn(() => choice);
      const store = sdkStore(fixture, select);
      await store.put(identity, value);
      expect(select).toHaveBeenCalledOnce();
      expect(fixture.send).toHaveBeenCalledOnce();
      expect(fixture.creates()).toHaveLength(1);
      expect(fixture.creates()[0].input).toEqual({
        ...body(value, choice),
        eventTimestamp: expect.any(Date),
      });
      expect(await store.get(identity, value.id)).toEqual(value);
      expect((await store.list(identity)).entries).toEqual([value]);
    },
  );

  it('put, mixed putMany and applied CAS use one selector and adapter invocation per entry', async () => {
    const fixture = clientFixture();
    const select = vi.fn(
      (value: MemoryEntry): Choice =>
        value.id === 'blob' ? { kind: 'blob' } : conversation(value.id),
    );
    const store = clientStore(fixture.client, select);
    await store.put(identity, entry('put'));
    await store.putMany(identity, [entry('blob'), entry('batch')]);
    await expect(store.putIfVersion(identity, entry('cas'), 0)).resolves.toEqual({ applied: true });
    expect(select.mock.calls.map(([value]) => value.id)).toEqual(['put', 'blob', 'batch', 'cas']);
    expect(fixture.createEvent).toHaveBeenCalledTimes(4);
    expect(fixture.listEvents).toHaveBeenCalledOnce();
    expect(fixture.createEvent.mock.calls.map(([input]) => input.eventPayload)).toEqual([
      conversation('put'),
      { kind: 'blob' },
      conversation('batch'),
      conversation('cas'),
    ]);
    expect(fixture.order).toEqual([
      'create:put',
      'create:blob',
      'create:batch',
      'read',
      'create:cas',
    ]);
  });

  it('stale CAS, empty batches and expired writes never evaluate the selector or create', async () => {
    const fixture = clientFixture(false);
    fixture.events.push({ eventId: 'existing', entry: entry('existing', { version: 7 }) });
    const select = vi.fn(() => conversation());
    const store = clientStore(fixture.client, select);
    await expect(store.putIfVersion(identity, entry('existing'), 6)).resolves.toEqual({
      applied: false,
      currentVersion: 7,
    });
    await store.putMany(identity, []);
    await store.put(identity, entry('expired-put', { ttl: 1 }));
    await store.putMany(identity, [entry('expired-batch', { ttl: 1 })]);
    await expect(
      store.putIfVersion(identity, entry('expired-cas', { ttl: 1 }), 0),
    ).resolves.toEqual({
      applied: true,
    });
    expect(select).not.toHaveBeenCalled();
    expect(fixture.createEvent).not.toHaveBeenCalled();
    expect(fixture.listEvents).toHaveBeenCalledTimes(2);
  });

  it('preserves CAS read-first order when a client cannot forward a conversation', async () => {
    const fixture = clientFixture(false);
    const select = vi.fn(() => {
      fixture.order.push('select');
      return conversation();
    });
    const store = clientStore(fixture.client, select);
    await expect(store.putIfVersion(identity, entry(), 0)).rejects.toThrow(/forwardsEventPayload/);
    expect(fixture.order).toEqual(['read', 'select']);
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.createEvent).not.toHaveBeenCalled();
  });

  it('old clients still accept omitted or explicitly selected blobs without a declaration', async () => {
    const fixture = clientFixture(false);
    await clientStore(fixture.client).put(identity, entry('omitted'));
    await clientStore(fixture.client, () => ({ kind: 'blob' })).put(identity, entry('explicit'));
    expect(fixture.createEvent).toHaveBeenCalledTimes(2);
    expect(fixture.createEvent.mock.calls[0][0]).not.toHaveProperty('eventPayload');
  });

  it('keeps extraction and namespace refusals before the existing CAS read and selector', async () => {
    const legacy = clientFixture();
    Reflect.deleteProperty(legacy.client, 'forwardsWriteOptions');
    const scoped = clientFixture();
    const select = vi.fn(() => conversation());
    await expect(
      clientStore(legacy.client, select).putIfVersion(identity, entry(), 0, { extraction: 'skip' }),
    ).rejects.toThrow(/forwardsWriteOptions/);
    await expect(
      clientStore(scoped.client, select).putIfVersion(identity, entry(), 0, {
        namespaceScope: { tenantid: 'PRIVATE.INVALID' },
      }),
    ).rejects.toThrow(/namespace/);
    expect(select).not.toHaveBeenCalled();
    for (const fixture of [legacy, scoped]) {
      expect(fixture.listEvents).not.toHaveBeenCalled();
      expect(fixture.createEvent).not.toHaveBeenCalled();
    }
  });

  it.each(['CreateEventInput$', 'PayloadType$', 'Conversational$', 'Content$'])(
    'refuses conversational writes without SDK model %s and never silently downgrades',
    async (model) => {
      const fixture = sdkFixture();
      Reflect.deleteProperty(fixture.sdk, model);
      const select = vi.fn(() => conversation());
      await expect(sdkStore(fixture, select).put(identity, entry())).rejects.toThrow(
        /eventPayload|conversational|Conversational/,
      );
      expect(select).toHaveBeenCalledOnce();
      expect(fixture.send).not.toHaveBeenCalled();
      await sdkStore(fixture).put(identity, entry('still-blob'));
      expect(fixture.send).toHaveBeenCalledOnce();
    },
  );

  it('refuses SDK model member lookalikes rather than accepting names from unrelated arrays', async () => {
    const fixture = sdkFixture();
    fixture.sdk.Content$ = [4, 'com.amazonaws.bedrockagentcore', 'Content', 0, [], ['text']];
    await expect(sdkStore(fixture, () => conversation()).put(identity, entry())).rejects.toThrow(
      /eventPayload|conversational|Conversational/,
    );
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it('accepts static schema export getters without evaluating lazy schema type entries', async () => {
    const fixture = sdkFixture();
    const lazy = vi.fn(() => {
      throw new Error('schema type must stay lazy');
    });
    const payloadModel = fixture.sdk.PayloadType$;
    Reflect.set(payloadModel, 5, [lazy, lazy, lazy]);
    Object.defineProperty(fixture.sdk, 'PayloadType$', { get: () => payloadModel });
    await sdkStore(fixture, () => conversation()).put(identity, entry());
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.creates()[0].input.payload).toEqual(body(entry(), conversation()).payload);
    expect(lazy).not.toHaveBeenCalled();
  });
});

describe('AgentCore event payload — foreign code is captured once', () => {
  it('captures the canonical blob before selector mutation of its detached input or original', async () => {
    const fixture = sdkFixture();
    const original = entry();
    const canonical = JSON.stringify(original);
    const select = vi.fn((detached: MemoryEntry): Choice => {
      expect(detached).not.toBe(original);
      expect(detached.value).not.toBe(original.value);
      (detached.value as { content: unknown }).content = 'edited detached content';
      (detached.metadata!.nested as { label: string }).label = 'edited detached metadata';
      (original.metadata!.nested as { label: string }).label = 'edited through closure';
      return conversation('explicitly chosen');
    });
    await sdkStore(fixture, select).put(identity, original);
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.creates()[0].input.payload).toEqual([
      { blob: canonical },
      { conversational: { content: { text: 'explicitly chosen' }, role: 'USER' } },
    ]);
    expect((original.value as { content: unknown }).content).toEqual([
      { type: 'text', text: 'rich original' },
    ]);
  });

  it('owns the returned choice before a client edits its argument or the foreign result', async () => {
    const choice = { kind: 'conversational' as const, role: 'user' as const, text: 'captured' };
    const original = entry();
    const fixture = clientFixture(true, (input) => {
      expect(input.eventPayload).toEqual(choice);
      expect(input.eventPayload).not.toBe(choice);
      expect(input.entry).not.toBe(original);
      expect(input.entry).toEqual(original);
      Reflect.set(input, 'eventPayload', { kind: 'blob' });
      Reflect.set(input.entry, 'value', 'client mutation');
      Object.defineProperty(choice, 'kind', {
        get: () => {
          throw new Error('reread');
        },
      });
    });
    const select = vi.fn(() => choice);
    await expect(
      clientStore(fixture.client, select).put(identity, original),
    ).resolves.toBeUndefined();
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.createEvent).toHaveBeenCalledOnce();
    expect(original).toEqual(entry());
  });

  it('sends a captured choice even when the SDK callback mutates the selector result', async () => {
    const fixture = sdkFixture();
    const choice = { kind: 'conversational' as const, role: 'assistant' as const, text: 'before' };
    fixture.onSend(() => {
      choice.text = 'after';
    });
    const select = vi.fn(() => choice);
    await sdkStore(fixture, select).put(identity, entry());
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.creates()[0].input.payload).toEqual(
      body(entry(), { ...choice, text: 'before' }).payload,
    );
  });

  it('preserves the exact thrown selector error without a client invocation', async () => {
    const fixture = clientFixture();
    const failure = new Error('foreign selector failure');
    const select = vi.fn((): Choice => {
      throw failure;
    });
    await expect(clientStore(fixture.client, select).put(identity, entry())).rejects.toBe(failure);
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.createEvent).not.toHaveBeenCalled();
  });

  it('preserves a proxy descriptor failure without invoking its getters or the client', async () => {
    const fixture = clientFixture();
    const failure = new Error('foreign descriptor failure');
    const getter = vi.fn();
    const choice = new Proxy(
      {},
      {
        ownKeys: () => {
          throw failure;
        },
        get: getter,
      },
    );
    await expect(
      clientStore(fixture.client, () => choice as Choice).put(identity, entry()),
    ).rejects.toBe(failure);
    expect(getter).not.toHaveBeenCalled();
    expect(fixture.createEvent).not.toHaveBeenCalled();
  });

  it.each(['kind', 'role', 'text', 'then', 'unknown', 'toJSON'])(
    'rejects a choice accessor %s without calling it',
    async (field) => {
      const fixture = clientFixture();
      const getter = vi.fn(() => {
        throw new Error('getter must never run');
      });
      const choice = { kind: 'conversational', role: 'user', text: 'secret accessor text' };
      Object.defineProperty(choice, field, { enumerable: true, get: getter });
      await expect(
        clientStore(fixture.client, () => choice as Choice).put(identity, entry()),
      ).rejects.toThrow(/eventPayload/);
      expect(getter).not.toHaveBeenCalled();
      expect(fixture.createEvent).not.toHaveBeenCalled();
    },
  );

  const invalidChoices = [
    null,
    undefined,
    false,
    'blob',
    [],
    {},
    { kind: 'unknown' },
    { kind: 'blob', text: 'extra' },
    { kind: 'conversational', role: 'system', text: 'secret-invalid-role' },
    { kind: 'conversational', role: 'user', text: 123 },
    { kind: 'conversational', role: 'user' },
    { kind: 'conversational', role: 'user', text: 'text', unknown: true },
    Object.create({ kind: 'blob' }),
    Object.assign(Object.create({ inherited: true }), { kind: 'blob' }),
    Object.assign({ kind: 'blob' }, { [Symbol('unknown')]: true }),
    Object.defineProperty({ kind: 'blob' }, 'unknown', { value: true }),
    Promise.resolve({ kind: 'blob' }),
    { kind: 'blob', then: () => undefined },
  ];
  it.each(invalidChoices.map((value, index) => ({ value, index })))(
    'refuses non-owned choice case $index before creating an event',
    async ({ value }) => {
      const fixture = clientFixture();
      const select = vi.fn(() => value as Choice);
      const failure = await clientStore(fixture.client, select)
        .put(identity, entry())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/eventPayload/);
      expect((failure as Error).message).not.toContain('secret-invalid-role');
      expect(select).toHaveBeenCalledOnce();
      expect(fixture.createEvent).not.toHaveBeenCalled();
    },
  );

  it('keeps library refusal bytes equal for different rejected private values', async () => {
    const messages: string[] = [];
    for (const role of ['private-role-A', 'private-role-B']) {
      const fixture = clientFixture();
      const select = () => ({ kind: 'conversational', role, text: `hidden ${role}` } as Choice);
      const failure = await clientStore(fixture.client, select)
        .put(identity, entry())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      messages.push((failure as Error).message);
      expect(fixture.createEvent).not.toHaveBeenCalled();
    }
    expect(messages[0]).toBe(messages[1]);
    expect(messages[0]).not.toMatch(/private-role|hidden/);
  });
});

describe('AgentCore event payload — bounded text and sequential failures', () => {
  it.each(['x', 'e\u0301😀', 'x'.repeat(100_000), 'é'.repeat(50_000), '😀'.repeat(25_000)])(
    'sends valid text without truncation (case %#)',
    async (text) => {
      const fixture = sdkFixture();
      await sdkStore(fixture, () => conversation(text)).put(identity, entry());
      expect(fixture.send).toHaveBeenCalledOnce();
      expect(fixture.creates()[0].input.payload).toEqual(body(entry(), conversation(text)).payload);
    },
  );

  it.each([
    '',
    '\ud800',
    '\udc00',
    'x\ud800y',
    'x'.repeat(100_001),
    'é'.repeat(50_001),
    '😀'.repeat(25_001),
  ])('rejects empty, malformed or over-limit text before send (case %#)', async (text) => {
    const fixture = sdkFixture();
    const select = vi.fn(() => conversation(text));
    await expect(sdkStore(fixture, select).put(identity, entry())).rejects.toThrow(/eventPayload/);
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it.each([0, 1])(
    'admits a mixed body at 10,000,000 UTF-8 bytes, refuses byte +%s',
    async (over) => {
      const fixture = sdkFixture();
      const value = entry('large', { metadata: { padding: '' } });
      const choice = conversation('é');
      const overhead = Buffer.byteLength(JSON.stringify(body(value, choice)), 'utf8');
      value.metadata!.padding = 'x'.repeat(10_000_000 - overhead + over);
      const write = sdkStore(fixture, () => choice).put(identity, value);
      if (over) {
        await expect(write).rejects.toThrow(/eventPayload|10.?000.?000/);
        expect(fixture.send).not.toHaveBeenCalled();
      } else {
        await expect(write).resolves.toBeUndefined();
        expect(fixture.send).toHaveBeenCalledOnce();
        expect(Buffer.byteLength(JSON.stringify(fixture.creates()[0].input), 'utf8')).toBe(
          10_000_000,
        );
      }
    },
  );

  it('keeps the written batch prefix when a later projection fails, with no adapter resend', async () => {
    const fixture = clientFixture();
    const failure = new Error('second projection failed');
    const select = vi.fn((value: MemoryEntry): Choice => {
      if (value.id === 'second') throw failure;
      return conversation(value.id);
    });
    await expect(
      clientStore(fixture.client, select).putMany(identity, [
        entry('first'),
        entry('second'),
        entry('third'),
      ]),
    ).rejects.toBe(failure);
    expect(select.mock.calls.map(([value]) => value.id)).toEqual(['first', 'second']);
    expect(fixture.createEvent).toHaveBeenCalledOnce();
    expect(fixture.events.map(({ entry: value }) => value.id)).toEqual(['first']);
  });

  it('does not retry an injected client error or invoke later batch selectors', async () => {
    const failure = new Error('client response unknown');
    const fixture = clientFixture(true, (input) => {
      if (input.entry.id === 'second') throw failure;
    });
    const select = vi.fn(() => conversation());
    await expect(
      clientStore(fixture.client, select).putMany(identity, [
        entry('first'),
        entry('second'),
        entry('third'),
      ]),
    ).rejects.toBe(failure);
    expect(select).toHaveBeenCalledTimes(2);
    expect(fixture.createEvent).toHaveBeenCalledTimes(2);
    expect(fixture.events.map(({ entry: value }) => value.id)).toEqual(['first']);
  });

  it('one lost SDK response remains the original failure after one send invocation', async () => {
    const fixture = sdkFixture();
    const failure = new Error('scripted lost response');
    fixture.onSend(() => {
      throw failure;
    });
    const select = vi.fn(() => conversation());
    await expect(sdkStore(fixture, select).put(identity, entry())).rejects.toBe(failure);
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.creates()).toHaveLength(1);
  });
});

describe('AgentCore event payload — source lifecycle is independent of seeded records', () => {
  it.each(['delete', 'forget'] as const)(
    '%s removes source events while derived records remain searchable',
    async (operation) => {
      const fixture = sdkFixture();
      const store = sdkStore(fixture, () => conversation());
      await store.put(identity, entry());
      await store.put(neighbour, entry('neighbour'));
      const derivedBefore = structuredClone(fixture.derived);
      if (operation === 'delete') await store.delete(identity, 'message');
      else await store.forget(identity);
      expect(await store.get(identity, 'message')).toBeNull();
      expect((await store.list(identity)).entries).toEqual([]);
      expect(await store.get(neighbour, 'neighbour')).toEqual(entry('neighbour'));
      expect(fixture.deletes()).toHaveLength(1);
      expect(fixture.sources).toHaveLength(1);
      expect(fixture.derived).toEqual(derivedBefore);
      const found = await store.search(identity, [], { text: 'derived content' });
      expect(found.map(({ entry: value }) => value.id)).toEqual(['derived-record']);
      expect(
        fixture.sent.every(({ name }) =>
          [
            'CreateEventCommand',
            'ListEventsCommand',
            'DeleteEventCommand',
            'RetrieveMemoryRecordsCommand',
          ].includes(name),
        ),
      ).toBe(true);
    },
  );

  it('entry TTL hides get/list locally with zero DeleteEvent calls while raw sources and records remain', async () => {
    const fixture = sdkFixture();
    fixture.seed([
      { blob: JSON.stringify(entry('expired', { ttl: 1 })) },
      { conversational: { content: { text: 'old conversation' }, role: 'USER' } },
    ]);
    const sourceBefore = structuredClone(fixture.sources);
    const select = vi.fn(() => conversation());
    const store = sdkStore(fixture, select);
    expect(await store.get(identity, 'expired')).toBeNull();
    expect((await store.list(identity)).entries).toEqual([]);
    expect(fixture.sources).toEqual(sourceBefore);
    expect(fixture.deletes()).toHaveLength(0);
    expect(fixture.creates()).toHaveLength(0);
    expect(select).not.toHaveBeenCalled();
    expect(
      (await store.search(identity, [], { text: 'derived content' })).map(
        ({ entry: value }) => value.id,
      ),
    ).toEqual(['derived-record']);
  });

  it('SKIP applies to the new mixed event and leaves an older independent derived record intact', async () => {
    const fixture = sdkFixture();
    const before = structuredClone(fixture.derived);
    const select = vi.fn(() => conversation());
    const store = sdkStore(fixture, select);
    await store.put(identity, entry(), {
      extraction: 'skip',
      namespaceScope: { tenantid: 'acme' },
    });
    expect(fixture.creates()[0].input).toEqual({
      ...body(entry(), conversation()),
      eventTimestamp: expect.any(Date),
      extractionMode: 'SKIP',
      extractionConfig: { namespaceVariables: { tenantid: 'acme' } },
    });
    expect(select).toHaveBeenCalledOnce();
    expect(fixture.send).toHaveBeenCalledOnce();
    expect(fixture.derived).toEqual(before);
    expect(fixture.deletes()).toHaveLength(0);
    // Use a fresh unscoped reader: the scoped writer keeps its existing scope guard.
    expect(
      (await sdkStore(fixture).search(identity, [], { text: 'derived content' })).map(
        ({ entry: value }) => value.id,
      ),
    ).toEqual(['derived-record']);
  });

  it('reads old string/object blobs and new mixed events, skips foreign conversation-only events', async () => {
    const fixture = sdkFixture();
    fixture.seed([{ blob: JSON.stringify(entry('old-string')) }]);
    fixture.seed([{ blob: entry('old-object') }]);
    fixture.seed([{ conversational: { content: { text: 'foreign' }, role: 'USER' } }]);
    const store = sdkStore(fixture, () => conversation());
    await store.put(identity, entry('new-mixed'));
    expect((await store.list(identity)).entries.map(({ id }) => id).sort()).toEqual([
      'new-mixed',
      'old-object',
      'old-string',
    ]);
    expect(fixture.creates()).toHaveLength(1);
  });
});
