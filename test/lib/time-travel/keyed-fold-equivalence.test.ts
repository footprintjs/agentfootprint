/**
 * keyedFold ≡ stateAt — the per-key fold agrees with the engine's own.
 *
 * `keyedFold.ts` exists because folding the WHOLE state once per read is
 * unaffordable for a per-epoch reader (measured: 11.7 s to fold once per epoch
 * on a 100-turn run, against 78 ms for the entire scrub). It is allowed to be
 * cheaper; it is NOT allowed to be different. So `stateAt` — the API
 * footprintjs shipped for exactly this question — is the ORACLE here, and every
 * case below asks both and requires the same answer.
 *
 * The cases are the ones where a fold can quietly lie: a value that came from
 * the run's initial state and was never written again (a RESUMED run, where
 * that is most of the state), a nested write (which no whole-key anchor can
 * absorb), a merge with no `set` anchor (which must land ON the base or lose
 * whatever the base held), and a recording that travelled without its base.
 *
 * Test types (Convention 3): unit (the delimiter, the empty source, a detached
 * answer) / functional (agreement at every commit of a real run) / integration
 * (a resumed agent, both chart shapes) / edge (an anchorless merge, no base) /
 * regression (the `commitValueAt` blind spot this module was built to close).
 */

import { describe, expect, it } from 'vitest';
import { commitValueAt, stateAt } from 'footprintjs/trace';
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { Agent } from '../../../src/index.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { keyedFold } from '../../../src/lib/time-travel/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

// ─── the harness ─────────────────────────────────────────────────────

function scripted(script: readonly LLMResponse[]) {
  let i = 0;
  return {
    name: 'fold-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> =>
      script[Math.min(i++, script.length - 1)]!,
  };
}

const resp = (
  content: string,
  toolCalls: readonly { id: string; name: string; args: Record<string, unknown> }[] = [],
): LLMResponse => ({
  content,
  toolCalls,
  usage: { input: 0, output: 0 },
  stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
});

/** Ask both folds for every key at every commit and collect the disagreements. */
function disagreements(
  source: { commitLog?: readonly unknown[]; initialState?: Record<string, unknown> },
  keys: readonly string[],
): string[] {
  const out: string[] = [];
  const fold = keyedFold(source);
  const length = (source.commitLog ?? []).length;
  for (let idx = -1; idx < length; idx++) {
    const truth = stateAt(source as never, idx);
    for (const key of keys) {
      const mine = JSON.stringify(fold.valueAt(key, idx) ?? null);
      const theirs = JSON.stringify(truth.state[key] ?? null);
      if (mine !== theirs) out.push(`${key}@${idx}: ${mine} != ${theirs}`);
    }
    if (fold.basis !== truth.basis) out.push(`basis@${idx}: ${fold.basis} != ${truth.basis}`);
  }
  return out;
}

// ─── (a) UNIT ────────────────────────────────────────────────────────

describe('the empty cases', () => {
  it('an absent source folds to nothing and says the base did not travel', () => {
    const fold = keyedFold(undefined);
    expect(fold.basis).toBe('log-only');
    expect(fold.length).toBe(0);
    expect(fold.valueAt('anything', 5)).toBeUndefined();
  });

  it('memoizes per source object, so a per-epoch reader indexes the log once', () => {
    const source = { commitLog: [], initialState: { a: 1 } };
    expect(keyedFold(source)).toBe(keyedFold(source));
    expect(keyedFold({ ...source })).not.toBe(keyedFold(source));
  });

  it('a value read straight off the base comes back frozen', () => {
    // The cheap half, and it is footprintjs's guarantee rather than this
    // module's: `stateAt` deep-freezes the state it returns, so a key with no
    // touches is already detached. Pinned so that a future `stateAt` which
    // stopped freezing would be caught HERE, where the assumption lives,
    // rather than in a reader that quietly gained a mutable answer.
    const source = { commitLog: [], initialState: { profile: { city: 'Chennai' } } };
    const value = keyedFold(source).valueAt('profile', -1) as { city: string };
    expect(Object.isFrozen(value)).toBe(true);
    expect((keyedFold(source).valueAt('profile', -1) as { city: string }).city).toBe('Chennai');
  });
});

// ─── (b) EDGE — the shapes a per-key fold can get wrong ──────────────

describe('a chart that seeds, nests, appends and deletes', () => {
  const build = () =>
    flowChart<{
      seeded: string;
      profile: { name: string; city: string };
      trail: string[];
      doomed?: string;
    }>(
      'Nest a write',
      (scope) => {
        // A NESTED write: no whole-key anchor, so the fold has to reach the
        // base for `profile` and apply the leaf on top of it.
        scope.profile.city = 'Chennai';
      },
      'nest',
    )
      .addFunction(
        'Append',
        (scope) => {
          scope.trail = [...(scope.trail ?? []), 'second'];
        },
        'append',
      )
      .addFunction(
        'Delete',
        (scope) => {
          scope.doomed = undefined;
        },
        'erase',
      )
      .build();

  const KEYS = ['seeded', 'profile', 'trail', 'doomed', 'never-written'];

  it('agrees with stateAt at every commit, including the pre-run base', async () => {
    const executor = new FlowChartExecutor(build(), {
      initialContext: {
        seeded: 'from the base',
        profile: { name: 'a', city: 'Madras' },
        trail: ['first'],
        doomed: 'goodbye',
      },
    } as never);
    await executor.run();
    const snapshot = executor.getSnapshot();
    expect(snapshot.commitLog.length).toBeGreaterThan(0);
    // The case is only worth running if the log really carries the shapes it
    // claims. A nested write records `profile` under the MERGE verb, which is
    // precisely the verb that cannot be folded without the base: there is no
    // `set` anchor to start from, so the delta has to land ON something.
    const verbs = new Set(snapshot.commitLog.flatMap((b) => b.trace.map((t) => t.verb)));
    expect(verbs.has('merge')).toBe(true);
    expect(verbs.size).toBeGreaterThan(1);
    expect(disagreements(snapshot as never, KEYS)).toEqual([]);

    // …and here is the difference in the one place it bites. The log-only
    // reader folds the merge onto nothing and loses the field the base held.
    const merged = commitValueAt(snapshot.commitLog as never, 0, 'profile') as {
      name?: string;
      city?: string;
    };
    expect(merged.city).toBe('Chennai');
    expect(merged.name).toBeUndefined();
    expect(keyedFold(snapshot as never).valueAt('profile', 0)).toEqual({
      name: 'a',
      city: 'Chennai',
    });
  });

  it('hands a REPLAYED value back detached — frozen, and the same every time', async () => {
    // The other half of memoizing, on the path that actually builds a value.
    // A replayed answer is a fresh object this module made, it is cached, and
    // the forward cursor seeds every LATER index from it — so a mutable one is
    // an answer a reader can rewrite for every reader after it. `stateAt`, the
    // oracle for this whole file, deep-freezes what it returns; this fold
    // exists to be a cheaper `stateAt`, not a laxer one.
    const executor = new FlowChartExecutor(build(), {
      initialContext: {
        seeded: 'from the base',
        profile: { name: 'a', city: 'Madras' },
        trail: ['first'],
        doomed: 'goodbye',
      },
    } as never);
    await executor.run();
    const snapshot = executor.getSnapshot();
    const fold = keyedFold(snapshot as never);

    const profile = fold.valueAt('profile', 0) as { city: string };
    expect(profile.city).toBe('Chennai'); // replayed, not read off the base
    expect(Object.isFrozen(profile)).toBe(true);
    expect(() => {
      profile.city = 'nowhere';
    }).toThrow();

    // Nested containers too — an array whose ELEMENTS stayed mutable would let
    // a reader edit a message inside a conversation, which is the shape that
    // actually bit.
    const trail = fold.valueAt('trail', snapshot.commitLog.length - 1) as string[];
    expect(trail.length).toBeGreaterThan(1);
    expect(Object.isFrozen(trail)).toBe(true);
    expect(() => trail.push('nope')).toThrow();

    expect(fold.valueAt('profile', 0)).toEqual({ name: 'a', city: 'Chennai' });
  });

  it('closes the blind spot commitValueAt documents: a seeded key never re-set', async () => {
    const executor = new FlowChartExecutor(build(), {
      initialContext: {
        seeded: 'from the base',
        profile: { name: 'a', city: 'Madras' },
        trail: ['first'],
      },
    } as never);
    await executor.run();
    const snapshot = executor.getSnapshot();
    const last = snapshot.commitLog.length - 1;

    // The old reader: the log alone cannot see the base, so a key the run
    // inherited and never wrote reads as absent.
    expect(commitValueAt(snapshot.commitLog as never, last, 'seeded')).toBeUndefined();
    // The new one folds from the base — and agrees with stateAt, which is the
    // engine's own answer to the same question.
    expect(keyedFold(snapshot as never).valueAt('seeded', last)).toBe('from the base');
    expect(stateAt(snapshot as never, last).state.seeded).toBe('from the base');
  });

  it('a recording that travelled without its base says log-only and folds nothing extra', async () => {
    const executor = new FlowChartExecutor(build(), {
      initialContext: { seeded: 'from the base', profile: { name: 'a', city: 'M' }, trail: [] },
    } as never);
    await executor.run();
    const baseless = JSON.parse(JSON.stringify(executor.getSnapshot())) as {
      commitLog: unknown[];
      initialState?: unknown;
    };
    delete baseless.initialState;

    const fold = keyedFold(baseless as never);
    expect(fold.basis).toBe('log-only');
    expect(fold.valueAt('seeded', baseless.commitLog.length - 1)).toBeUndefined();
    // Still equivalent — both folds are honestly short in the same way.
    expect(disagreements(baseless as never, ['seeded', 'profile'])).toEqual([]);
  });
});

// ─── (c) INTEGRATION — the run that made this necessary ──────────────

describe('a resumed agent run', () => {
  for (const reactMode of ['dynamic', 'dynamic-grouped'] as const) {
    it(`${reactMode}: every key the resumed call read agrees with stateAt`, async () => {
      const agent = Agent.create({
        provider: scripted([resp('', [{ id: 't', name: 'ask', args: {} }]), resp('done')]) as never,
        model: 'mock',
        reactMode,
      })
        .system('you are a bot')
        .tool({
          schema: { name: 'ask', description: 'ask', inputSchema: { type: 'object' } },
          execute: () => {
            pauseHere({ q: 'ok?' });
            return '';
          },
        })
        .build();

      const paused = await agent.run({ message: 'go' });
      expect(isPaused(paused)).toBe(true);
      if (!isPaused(paused)) return;
      await agent.resume(paused.checkpoint, 'yes');
      const snapshot = agent.getSnapshot()!;

      // A resume is a fresh executor seeded from the checkpoint, so the base
      // is where nearly everything lives.
      expect(snapshot.initialState).toBeDefined();
      expect(Object.keys(snapshot.initialState!).length).toBeGreaterThan(3);
      expect(
        disagreements(snapshot as never, [
          'systemPromptInjections',
          'history',
          'dynamicToolSchemas',
          'iteration',
          'wrapUpAsked',
          'receipt',
        ]),
      ).toEqual([]);
    });
  }
});
