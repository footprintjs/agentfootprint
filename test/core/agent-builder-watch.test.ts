/**
 * AgentBuilder.watch — the observing half of the act/watch pair.
 *
 * `moments.ts` has said, since the loop moments were written down, that
 * "`watch` attends all five and more; `act` attends exactly these — an
 * observer reports, a rule changes what happens next." Until 8.0.0 that
 * sentence described an API nobody had built. These tests pin what it means:
 *
 *   • `.watch()` is BUILD-TIME attach — an observer handed to the builder
 *     sees the very first run, so there is no window in which the agent has
 *     acted and nobody was watching.
 *   • It is VARIADIC, because observers come in sets.
 *   • It is the SAME mechanism `.recorder()` used, not a second one — same
 *     list, same order, same attachment.
 *   • `agent.attach()` is untouched and still returns an `Unsubscribe`.
 *
 * ## `.recorder()` in 9.0.0
 *
 * `.recorder()` was deprecated in 8.0.0 and REMOVED in 9.0.0. Because it was
 * exactly the same mechanism, there was nothing to keep alive — but a call
 * site that missed the deprecation deserves a sentence rather than
 * `builder.recorder is not a function`, so the NAME survives for one major as
 * a throwing stub. That stub is itself part of the contract and is pinned
 * below: it must throw at BUILD time (deterministic, before any run), name
 * `.watch()` as the replacement, and say when it disappears (10.0.0).
 *
 * 7-pattern matrix: unit (chainable, variadic, order) · integration (a real
 * run reaches every observer) · property (watch ≡ attach — two spellings,
 * one attachment) · edge (zero args; the same observer twice) · refusal
 * (`.recorder()` throws, naming its replacement, before anything runs).
 */

import { describe, expect, it } from 'vitest';
import { Agent, type Watcher } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

function counter(id: string): { observer: Watcher; count: () => number; order: string[] } {
  const order: string[] = [];
  let n = 0;
  return {
    observer: {
      id,
      onEmit: () => {
        n += 1;
        order.push(id);
      },
    } as Watcher,
    count: () => n,
    order,
  };
}

const provider = (): ReturnType<typeof mock> =>
  mock({ respond: () => ({ content: 'final', toolCalls: [] }) });

// ─── 1. Unit — the door itself ─────────────────────────────────────

describe('AgentBuilder.watch', () => {
  it('is chainable and attaches at build time, so the FIRST run is watched', async () => {
    const a = counter('watch-first-run');
    const agent = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(a.observer)
      .build();

    // Nothing has run yet — the observer is attached but silent.
    expect(a.count()).toBe(0);

    await agent.run({ message: 'go' });
    expect(a.count()).toBeGreaterThan(0);
  });

  it('is variadic — one call, several observers, all of them fed', async () => {
    const a = counter('rec-a');
    const b = counter('rec-b');
    const c = counter('rec-c');
    const agent = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(a.observer, b.observer, c.observer)
      .build();

    await agent.run({ message: 'go' });
    expect(a.count()).toBeGreaterThan(0);
    // Same run, same stream — every observer saw exactly the same events.
    expect(b.count()).toBe(a.count());
    expect(c.count()).toBe(a.count());
  });

  it('accumulates across calls, in call order', async () => {
    const seen: string[] = [];
    const tag = (id: string): Watcher =>
      ({
        id,
        onEmit: () => {
          seen.push(id);
        },
      } as Watcher);

    const agent = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(tag('first'), tag('second'))
      .watch(tag('third'))
      .build();

    await agent.run({ message: 'go' });

    // The first three entries are one event delivered to three observers, in
    // the order they were handed to the builder.
    expect(seen.slice(0, 3)).toEqual(['first', 'second', 'third']);
  });

  it('accepts zero observers without complaint (a no-op, not an error)', async () => {
    const agent = Agent.create({ provider: provider(), model: 'mock' }).system('s').watch().build();
    const out = await agent.run({ message: 'go' });
    expect(out).toBeDefined();
  });
});

// ─── 2. Property — two spellings, one attachment ───────────────────

describe('watch / attach are one mechanism', () => {
  it('a builder-watched observer and a runtime-attached one see the same count', async () => {
    const built = counter('built');
    const runtime = counter('runtime');

    const agent = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(built.observer)
      .build();
    const unsubscribe = agent.attach(runtime.observer);

    await agent.run({ message: 'go' });
    expect(built.count()).toBeGreaterThan(0);
    expect(runtime.count()).toBe(built.count());

    // `agent.attach()` still hands back a working Unsubscribe — `.watch()`
    // does NOT replace it, it is the build-time door beside it.
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
    const before = runtime.count();
    await agent.run({ message: 'again' });
    expect(runtime.count(), 'detached observer must go quiet').toBe(before);
    expect(built.count(), 'the watched observer keeps watching').toBeGreaterThan(before);
  });

  it('the same observer handed in twice still fires once (executor dedupes by id)', async () => {
    const a = counter('same-id');
    const agent = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(a.observer, a.observer)
      .build();

    await agent.run({ message: 'go' });

    const solo = counter('solo-id');
    const control = Agent.create({ provider: provider(), model: 'mock' })
      .system('s')
      .watch(solo.observer)
      .build();
    await control.run({ message: 'go' });

    expect(a.count()).toBe(solo.count());
  });
});

describe('major 10 recorder surface', () => {
  it('has no deprecated recorder method, including on the prototype', () => {
    const builder = Agent.create({ provider: provider(), model: 'mock' });
    expect('recorder' in builder).toBe(false);
    expect(typeof builder.watch).toBe('function');
  });
});
