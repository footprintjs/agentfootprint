import { describe, expect, it, vi } from 'vitest';
import { AgentCoreStore } from '../../../src/adapters/memory/agentcore.js';
import {
  clientFixture,
  clientStore,
  entry,
  identity,
  sdkFixture,
  sdkStore,
} from './agentcore-event-payload.fixtures.js';
import type { Choice, Selector } from './agentcore-event-payload.fixtures.js';

describe('AgentCore event payload — one captured boundary declaration', () => {
  it.each(['omitted', 'blob', 'conversational'] as const)(
    'a client cannot change the captured namespace for a later batch event (%s)',
    async (mode) => {
      const scopes: unknown[] = [];
      const fixture = clientFixture(true, (input) => {
        scopes.push({ ...input.extractionConfig?.namespaceVariables });
        if (input.entry.id === 'one') {
          Reflect.set(input.extractionConfig!, 'namespaceVariables', { tenantid: 'other' });
        }
      });
      const select: Selector | undefined =
        mode === 'omitted'
          ? undefined
          : () =>
              mode === 'blob'
                ? { kind: 'blob' }
                : { kind: 'conversational', role: 'user', text: 'owned' };
      await clientStore(fixture.client, select).putMany(identity, [entry('one'), entry('two')], {
        namespaceScope: { tenantid: 'acme' },
      });
      expect(scopes).toEqual([{ tenantid: 'acme' }, { tenantid: 'acme' }]);
      expect(fixture.createEvent).toHaveBeenCalledTimes(2);
    },
  );
  it('does not inspect the new client capability when the selector is omitted', async () => {
    const fixture = clientFixture(false);
    const read = vi.fn(() => {
      throw new Error('optional declaration is unreadable');
    });
    Object.defineProperty(fixture.client, 'forwardsEventPayload', { get: read });
    await clientStore(fixture.client).put(identity, entry());
    expect(read).not.toHaveBeenCalled();
    expect(fixture.createEvent).toHaveBeenCalledOnce();
  });

  it('an unreadable optional client declaration permits blobs and refuses conversation by name', async () => {
    const fixture = clientFixture(false);
    const failure = new Error('optional declaration is unreadable');
    const read = vi.fn(() => {
      throw failure;
    });
    Object.defineProperty(fixture.client, 'forwardsEventPayload', { get: read });
    await clientStore(fixture.client, () => ({ kind: 'blob' })).put(identity, entry());
    await expect(
      clientStore(fixture.client, () => ({
        kind: 'conversational',
        role: 'user',
        text: 'owned',
      })).put(identity, entry()),
    ).rejects.toThrow(/forwardsEventPayload/);
    expect(read).toHaveBeenCalledTimes(2);
    expect(fixture.createEvent).toHaveBeenCalledOnce();
  });

  it('does not inspect new SDK schemas when the selector is omitted', async () => {
    const fixture = sdkFixture();
    const read = vi.fn(() => {
      throw new Error('unneeded schema');
    });
    for (const name of ['PayloadType$', 'Conversational$', 'Content$']) {
      Object.defineProperty(fixture.sdk, name, { get: read });
    }
    await sdkStore(fixture).put(identity, entry());
    expect(read).not.toHaveBeenCalled();
    expect(fixture.send).toHaveBeenCalledOnce();
  });
  it('captures the selector once and invokes it unbound for each actual write', async () => {
    const fixture = clientFixture();
    const receivers: unknown[] = [];
    const selector = vi.fn(function (this: unknown): Choice {
      receivers.push(this);
      return { kind: 'blob' };
    });
    const read = vi.fn((): Selector => selector);
    const options = {
      memoryId: 'memory',
      client: fixture.client,
      get eventPayload() {
        return read();
      },
    };
    const store = new AgentCoreStore(options);
    await store.putMany(identity, [entry('one'), entry('two')]);
    expect(read).toHaveBeenCalledOnce();
    expect(selector).toHaveBeenCalledTimes(2);
    expect(receivers).toEqual([undefined, undefined]);
  });

  it('does not reread a client capability after projection code can mutate the client', async () => {
    const fixture = clientFixture();
    const read = vi.fn(() => true);
    Object.defineProperty(fixture.client, 'forwardsEventPayload', {
      configurable: true,
      get: read,
    });
    const store = clientStore(fixture.client, () => {
      Object.defineProperty(fixture.client, 'forwardsEventPayload', {
        get: () => {
          throw new Error('reread');
        },
      });
      return { kind: 'conversational', role: 'user', text: 'owned' };
    });
    await store.put(identity, entry());
    expect(read).toHaveBeenCalledOnce();
    expect(fixture.createEvent).toHaveBeenCalledOnce();
  });

  it('reads shared SDK metadata once for extraction and conversational declarations', async () => {
    const fixture = sdkFixture();
    const model = fixture.sdk.CreateEventInput$;
    const read = vi.fn(() => model);
    Object.defineProperty(fixture.sdk, 'CreateEventInput$', { get: read });
    const store = sdkStore(fixture, () => ({
      kind: 'conversational',
      role: 'other',
      text: 'owned',
    }));
    await store.put(identity, entry(), { extraction: 'skip' });
    expect(read).toHaveBeenCalledOnce();
    expect(fixture.creates()[0].input).toMatchObject({ extractionMode: 'SKIP' });
  });

  it.each(['CreateEventInput$', 'PayloadType$', 'Conversational$', 'Content$'])(
    'unreadable SDK model %s refuses conversation but preserves ordinary blob writes',
    async (name) => {
      const fixture = sdkFixture();
      Object.defineProperty(fixture.sdk, name, {
        get: () => {
          throw new Error('unreadable model');
        },
      });
      await expect(
        sdkStore(fixture, () => ({ kind: 'conversational', role: 'user', text: 'private' })).put(
          identity,
          entry(),
        ),
      ).rejects.toThrow(/eventPayload/);
      expect(fixture.send).not.toHaveBeenCalled();
      await sdkStore(fixture).put(identity, entry());
      expect(fixture.send).toHaveBeenCalledOnce();
    },
  );

  it('an accessor at a schema member index grants no conversation capability and never runs', async () => {
    const fixture = sdkFixture();
    const getter = vi.fn(() => ['text']);
    Object.defineProperty(fixture.sdk.Content$, '4', { get: getter });
    await expect(
      sdkStore(fixture, () => ({ kind: 'conversational', role: 'user', text: 'owned' })).put(
        identity,
        entry(),
      ),
    ).rejects.toThrow(/eventPayload/);
    expect(getter).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
