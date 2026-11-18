import { describe, expect, it, vi } from 'vitest';
import { Agent, inMemoryArtifacts } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { FlowChartExecutor } from 'footprintjs';
import { fixture, identity } from './preparationFixture.js';

describe('source metadata preparation boundaries', () => {
  it('expires retained metadata, and uses actual fixed-phase native flows', async () => {
    let now = 1;
    const store = inMemoryArtifacts({ retention: { ttlMs: 10 }, _now: () => now });
    const first = fixture({ store });
    await first.agent.run({ message: 'Collect array-01', identity });
    now = 20;
    const run = vi.spyOn(FlowChartExecutor.prototype, 'run');
    const restored = fixture({ store });
    await restored.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    expect(restored.pages.at(-1).candidates).toEqual([]);
    expect(run.mock.calls.some((args) => JSON.stringify(args[0]) === '{"input":{}}')).toBe(true);
    run.mockRestore();
  });

  it('bounds waiting on fresh admission and detaches a request cancellation listener', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    const restored = fixture({
      store: first.store,
      timeoutMs: 10,
      admit: () => new Promise(() => {}),
    });
    await restored.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    expect(restored.pages.at(-1)).toEqual({ historical: true, unavailable: true });
    const abort = new AbortController();
    const cancelled = fixture({
      store: first.store,
      admit: (_candidate, context) =>
        new Promise((resolve) => {
          context.signal.addEventListener('abort', () => resolve(undefined), { once: true });
          abort.abort();
        }),
    });
    await cancelled.agent
      .run(
        { message: 'Inspect history', identity, continueFrom: first.agent.checkpoint()! },
        { env: { signal: abort.signal } },
      )
      .catch(() => undefined);
    expect(cancelled.pages.at(-1)).toEqual({ historical: true, unavailable: true });
  });

  it('refreshes a current provider once per preparation and never reuses a prior executable cache', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    const list = vi.fn(() => [{ ...first.tool, source: 'new-source' }]);
    const restored = fixture({ store: first.store, provider: { id: 'fresh-catalog', list } });
    await restored.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    expect(restored.pages.at(-1).candidates).toEqual([]);
    expect(list.mock.calls.filter((args: any[]) => args[0]?.iteration === 0)).toHaveLength(1);
    expect(restored.executions()).toBe(0);
  });

  it('gives preparation admission detached metadata and never a scalar or dataset descriptor', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    const restored = fixture({
      store: first.store,
      admit: (candidate, context) => {
        expect(Object.isFrozen(context.identity)).toBe(true);
        expect(Object.keys(candidate)).not.toContain('scalars');
        expect(Object.keys(candidate)).not.toContain('datasets');
        return { ...candidate, subject: { ...candidate.subject, value: 'forged' } };
      },
    });
    await restored.agent.run({
      message: 'Inspect history',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    expect(restored.pages.at(-1)).toEqual({ historical: true, unavailable: true });
    expect(identity.principal).toBe('alice');
  });

  it('pages exact newest-first metadata and respects a smaller restored index limit', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    await first.agent.run({
      message: 'Collect array-02',
      identity,
      continueFrom: first.agent.checkpoint()!,
    });
    const checkpoint = first.agent.checkpoint()!;
    const restored = fixture({
      store: first.store,
      inspect: async (reader) => {
        const page = await reader.recent({ limit: 1 });
        expect(page.candidates.map((entry: any) => entry.subject.value)).toEqual(['array-02']);
        expect(page.complete).toBe(false);
        const next = await reader.recent({ limit: 1, cursor: page.nextCursor });
        expect(next.candidates.map((entry: any) => entry.subject.value)).toEqual(['array-01']);
        expect(next.complete).toBe(true);
        return next;
      },
    });
    await restored.agent.run({ message: 'Inspect history', identity, continueFrom: checkpoint });
    const smaller = fixture({ store: first.store, maxReceipts: 1 });
    await smaller.agent.run({ message: 'Inspect history', identity, continueFrom: checkpoint });
    expect(smaller.pages.at(-1).candidates.map((entry: any) => entry.subject.value)).toEqual([
      'array-02',
    ]);
    expect(smaller.pages.at(-1).complete).toBe(false);
  });

  it('cannot proceed after a current permission halt even if the wrapper catches it', async () => {
    const first = fixture();
    await first.agent.run({ message: 'Collect array-01', identity });
    const halted = fixture({
      store: first.store,
      checker: { check: () => ({ result: 'halt' }) },
      inspect: async (reader) => {
        await reader.recent().catch(() => undefined);
        return { ignored: true };
      },
    });
    await expect(
      halted.agent.run({
        message: 'Inspect history',
        identity,
        continueFrom: first.agent.checkpoint()!,
      }),
    ).rejects.toThrow('Current policy halted retained source access.');
    expect(halted.executions()).toBe(0);
  });

  it('does not retain a provider-only implementation after the current catalog removes it', async () => {
    const source = fixture();
    let present = true;
    const pages: any[] = [];
    const provider = mock({
      respond: (request) =>
        request.messages.at(-1)?.role === 'tool'
          ? 'Done.'
          : {
              toolCalls: [
                {
                  id: 'provider-source',
                  name: source.tool.schema.name,
                  args: { array: 'provider-array' },
                },
              ],
            },
    });
    const original = Agent.create({ provider, model: 'mock', artifacts: source.store })
      .toolProvider({ id: 'provider-only', list: () => (present ? [source.tool] : []) })
      .sourceEvidence({
        admit: (candidate) => candidate,
        preparation: { admit: (candidate) => candidate },
      })
      .aroundTurn({
        name: 'provider-metadata',
        async around(turn, proceed) {
          if (turn.kind === 'run') pages.push(await turn.sourceEvidence!.recent());
          await proceed();
        },
      })
      .build();
    await original.run({ message: 'Collect provider source', identity });
    const checkpoint = original.checkpoint()!;
    present = false;
    const restored = Agent.create({
      provider: mock({ reply: 'Done.' }),
      model: 'mock',
      artifacts: source.store,
    })
      .toolProvider({ id: 'provider-only', list: () => [] })
      .sourceEvidence({
        admit: (candidate) => candidate,
        preparation: { admit: (candidate) => candidate },
      })
      .aroundTurn({
        name: 'removed-producer',
        async around(turn, proceed) {
          if (turn.kind === 'run') pages.push(await turn.sourceEvidence!.recent());
          await proceed();
        },
      })
      .build();
    await restored.run({ message: 'Inspect source', identity, continueFrom: checkpoint });
    expect(pages.at(-1).candidates).toEqual([]);
    expect(source.executions()).toBe(1);
  });

  it.each(['signal', 'env'] as const)(
    'honors %s cancellation when both native signal positions are present',
    async (position) => {
      const first = fixture();
      await first.agent.run({ message: 'Collect array-01', identity });
      const abort = new AbortController(),
        other = new AbortController();
      const restored = fixture({
        store: first.store,
        admit: (_candidate, context) =>
          new Promise((resolve) => {
            context.signal.addEventListener('abort', () => resolve(undefined), { once: true });
            abort.abort();
          }),
      });
      const options =
        position === 'signal'
          ? { signal: abort.signal, env: { signal: other.signal } }
          : { signal: other.signal, env: { signal: abort.signal } };
      await restored.agent
        .run(
          { message: 'Inspect history', identity, continueFrom: first.agent.checkpoint()! },
          options,
        )
        .catch(() => undefined);
      expect(restored.pages.at(-1)).toEqual({ historical: true, unavailable: true });
    },
  );
});
