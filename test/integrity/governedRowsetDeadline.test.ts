import type { AgentfootprintEvent } from '../../src/events.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, defineTool, inMemoryArtifacts, type ArtifactStore } from '../../src/index.js';
import { mock } from '../../src/providers.js';

const KIND = 'dataset/deadline-fixture';
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());

function fixture(mode: 'warn' | 'enforce', multi = false) {
  const backend = inMemoryArtifacts(),
    firstRead = deferred(),
    stalledRead = deferred();
  const releaseFirst = deferred(),
    releaseStalled = deferred();
  const events: AgentfootprintEvent[] = [];
  let gets = 0,
    executions = 0,
    served = '';
  const store: ArtifactStore = {
    ...backend,
    async get(scope, ref) {
      const record = await backend.get(scope, ref);
      gets++;
      if (multi && gets === 1) {
        firstRead.resolve();
        await releaseFirst.promise;
      } else {
        stalledRead.resolve();
        await releaseStalled.promise;
      }
      return record;
    },
  };
  const keys = multi ? ['first', 'stalled', 'remaining'] : ['stalled'];
  const tool = defineTool({
    name: 'source',
    description: 'Read synthetic delayed rows.',
    resultRowsets: keys.map((key) => ({
      key,
      columns: { amount: 'number' as const },
      source: {
        kind: 'published-dataset' as const,
        refPath: [key],
        artifactKind: KIND,
        maxRows: 1000,
        maxBytes: 1048576,
      },
    })),
    async execute(_args, context) {
      executions++;
      const result: Record<string, string> = {};
      for (const key of keys)
        result[key] = (
          await context.artifacts.put({
            kind: KIND,
            mediaType: 'application/json',
            digest: 'sha-256',
            data: [{ amount: multi && key === 'first' ? 'real-completed-mismatch' : 0 }],
          })
        ).ref;
      return result;
    },
  });
  const agent = Agent.create({
    model: 'mock',
    artifacts: store,
    checkColumnTypes: mode,
    integrityPosture: 'dev',
    provider: mock({
      respond(request) {
        const last = request.messages.at(-1);
        if (last?.role === 'tool') {
          served = last.content;
          return 'Observed.';
        }
        return { toolCalls: [{ id: 'deadline', name: 'source', args: {} }] };
      },
    }),
  })
    .tool(tool)
    .build();
  agent.on('*', (event) => events.push(event));
  return {
    agent,
    events,
    firstRead,
    stalledRead,
    releaseFirst,
    releaseStalled,
    counts: () => ({ gets, executions, served }),
    checks: () =>
      events
        .filter((event) => event.type === 'agentfootprint.tools.rowset_checked')
        .map((event) => event.payload),
  };
}

describe('one native5-second publication-read budget per final tool call', () => {
  it.each(['warn', 'enforce'] as const)(
    '%s ends a silent store wait, and late completion gains no authority',
    async (mode) => {
      // Only advance the timer owner; native traversal, Date and promises remain real.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const observed = fixture(mode);
      let finished = false;
      const run = observed.agent.run({ message: 'Read delayed fixture.' }).then((result) => {
        finished = true;
        return result;
      });
      try {
        await observed.stalledRead.promise;
        await vi.advanceTimersByTimeAsync(4999);
        expect(finished).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await run;
        expect(observed.counts()).toMatchObject({ gets: 1, executions: 1 });
        expect(observed.checks()).toMatchObject([
          {
            disposition: 'unavailable',
            reason: 'store-unavailable',
            delivery: mode === 'enforce' ? 'refused' : 'unchanged',
          },
        ]);
        expect(observed.counts().served).toMatch(
          mode === 'enforce' ? /^Result rejected:/ : /stalled/,
        );
        expect(
          observed.events.filter(
            (event) => event.type === 'agentfootprint.integrity.context_error',
          ),
        ).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        observed.releaseStalled.resolve();
        await run.catch(() => undefined);
      }
      await Promise.resolve();
      expect(observed.checks()).toHaveLength(1);
    },
  );

  it('shares the same budget across bindings, preserves a completed finding, and never reads remaining data', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const observed = fixture('warn', true);
    let finished = false;
    const run = observed.agent.run({ message: 'Read several delayed fixtures.' }).then((result) => {
      finished = true;
      return result;
    });
    try {
      await observed.firstRead.promise;
      await vi.advanceTimersByTimeAsync(4500);
      observed.releaseFirst.resolve();
      await observed.stalledRead.promise;
      await vi.advanceTimersByTimeAsync(499);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await run;
      expect(observed.counts()).toMatchObject({ gets: 2, executions: 1 });
      expect(observed.checks()).toMatchObject([
        { rowset: 'first', reason: 'rows', disposition: 'checked-fail' },
        { rowset: 'stalled', reason: 'store-unavailable', disposition: 'unavailable' },
        { rowset: 'remaining', reason: 'store-unavailable', disposition: 'unavailable' },
      ]);
      expect(
        observed.events
          .filter((event) => event.type === 'agentfootprint.integrity.context_error')
          .map((event) => event.payload),
      ).toMatchObject([{ rowset: 'first', kind: 'column-type-mismatch' }]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      observed.releaseFirst.resolve();
      observed.releaseStalled.resolve();
      await run.catch(() => undefined);
    }
    await Promise.resolve();
    expect(observed.checks()).toHaveLength(3);
  });

  it('parent cancellation wins and disarms the deadline instead of filing timeout availability', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const observed = fixture('enforce');
    const controller = new AbortController();
    const run = observed.agent.run(
      { message: 'Read cancelled fixture.' },
      { env: { signal: controller.signal } },
    );
    try {
      await observed.stalledRead.promise;
      await vi.advanceTimersByTimeAsync(4000);
      controller.abort(new Error('Parent cancelled fixture.'));
      await expect(run).rejects.toThrow(/Parent cancelled fixture/);
      expect(observed.checks()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1000);
      expect(observed.checks()).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      observed.releaseStalled.resolve();
      await run.catch(() => undefined);
    }
  });
});
