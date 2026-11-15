import { describe, expect, it, vi } from 'vitest';
import { inMemoryArtifacts } from '../../src/index.js';

import { fixture, identity } from './preparationFixture.js';

describe('source metadata in native turn preparation', () => {
  it('is absent without explicit preparation admission', async () => {
    const f = fixture({ mounted: false });
    await f.agent.run({ message: 'Collect array-01', identity });
    expect(f.reader()).toBeUndefined();
    expect(f.executions()).toBe(1);
  });

  it('reads newest native retained metadata before configure, without source execution or scalar values', async () => {
    const f = fixture();
    await f.agent.run({ message: 'Collect array-01', identity });
    const first = f.agent.checkpoint()!;
    await f.agent.run({ message: 'Collect array-02', identity, continueFrom: first });
    await f.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: f.agent.checkpoint()!,
    });
    const page = f.pages.at(-1);
    expect(page.candidates.map((entry: any) => entry.subject.value)).toEqual([
      'array-02',
      'array-01',
    ]);
    expect(page.candidates[0]).toMatchObject({
      producer: { name: 'read_inventory' },
      operation: 'inventory',
      scope: { group: 'application' },
    });
    expect(typeof page.candidates[0].recordedAt).toBe('number');
    expect(JSON.stringify(page)).not.toContain('PRIVATE-SCALAR');
    expect(
      page.candidates.every((entry: any) => !('scalars' in entry) && !('datasets' in entry)),
    ).toBe(true);
    expect(f.executions()).toBe(2);
    expect(f.contexts.at(-1)).toMatchObject({ identity });
    for (const key of ['toolCallId', 'iteration', 'artifacts', 'tools', 'credential'])
      expect(key in f.contexts.at(-1)).toBe(false);
  });

  it('restores onto a fresh runner from a host-kept checkpoint, and refuses a foreign identity', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    const checkpoint = JSON.parse(JSON.stringify(first.agent.checkpoint()));
    const restored = fixture({ store: first.store });
    await restored.agent.run({ message: 'Inspect history', identity, continueFrom: checkpoint });
    expect(restored.pages.at(-1).candidates.map((entry: any) => entry.subject.value)).toEqual([
      'array-01',
    ]);
    expect(restored.executions()).toBe(0);
    const foreign = fixture({ store: first.store });
    await foreign.agent.run({
      message: 'Inspect history',
      identity: { ...identity, principal: 'bob' },
      continueFrom: checkpoint,
    });
    expect(foreign.pages.at(-1).candidates).toEqual([]);
    expect(foreign.contexts).toEqual([]);
  });

  it('enforces current source permission and fresh admission without granting old executable authority', async () => {
    let verdict = 'allow';
    const check = vi.fn(() => ({ result: verdict }));
    const f = fixture({ checker: { check } });
    await f.agent.run({ message: 'Collect array-01', identity });
    const checkpoint = f.agent.checkpoint()!;
    verdict = 'deny';
    await f.agent.run({ message: 'Inspect history', identity, continueFrom: checkpoint });
    expect(f.pages.at(-1).candidates).toEqual([]);
    const denied = fixture({ store: f.store, admit: () => undefined });
    await denied.agent.run({ message: 'Inspect history', identity, continueFrom: checkpoint });
    expect(denied.pages.at(-1).candidates).toEqual([]);
    expect(f.executions()).toBe(1);
  });

  it('revokes borrowed metadata readers after proceed and before a later turn', async () => {
    const f = fixture();
    await f.agent.run({ message: 'Collect array-01', identity });
    const borrowed = f.reader();
    expect(await borrowed.recent()).toEqual({ historical: true, unavailable: true });
    await f.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: f.agent.checkpoint()!,
    });
    expect(await borrowed.recent()).toEqual({ historical: true, unavailable: true });
  });

  it('does not serve a receipt deleted during asynchronous admission', async () => {
    const store = inMemoryArtifacts();
    const first = fixture({ store });
    await first.agent.run({ message: 'Collect array-01', identity });
    const restored = fixture({
      store,
      admit: async (candidate) => {
        await store.delete(identity, candidate.ref);
        return candidate;
      },
    });
    await restored.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    expect(restored.pages.at(-1).candidates).toEqual([]);
  });
});
