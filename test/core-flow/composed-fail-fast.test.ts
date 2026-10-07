/**
 * A composed agent's reliability fail-fast fails the composition.
 *
 * An agent mounted as a composition's child never reaches its own run boundary
 * (`Agent · finalizeResult`), which is where the fail-fast record becomes
 * `ReliabilityFailFastError`. Until this was fixed the record stayed behind the
 * child's mount: `Sequence.step(ff).step(next)` ran `next` on an empty input and
 * returned ITS answer, and nothing was raised.
 *
 * The rule pinned here: a child that failed fast is a FAILED child, in every
 * reactMode and every composition. Where a composition hands a child's error
 * on as it is (Sequence, Workflow, Conditional, Loop) the run raises the same
 * error the agent raises on its own and nothing after the child runs; where a
 * composition reports a failed child its own way (Parallel's merge, Graph's
 * level join), the failure is reported there with the fail-fast's message.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  Conditional,
  LLMCall,
  Loop,
  Parallel,
  Sequence,
  graph,
  workflow,
  type LLMProvider,
} from '../../src/index.js';
import { ReliabilityFailFastError } from '../../src/reliability/index.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
type Mode = (typeof MODES)[number];

const KIND = 'composed-stop';

function failFastAgent(mode: Mode): Agent {
  return Agent.create({
    provider: {
      name: 'upstream-failing',
      complete: async () => {
        throw new Error('upstream 500');
      },
    },
    model: 'mock',
    reactMode: mode,
  })
    .reliability({ postDecide: [{ when: () => true, then: 'fail-fast', kind: KIND }] })
    .build();
}

/** A child that counts its runs — it must never run after a failed child. */
function probe(): { readonly runner: LLMCall; readonly calls: () => number } {
  let calls = 0;
  const provider: LLMProvider = {
    name: 'probe',
    complete: async () => {
      calls += 1;
      return {
        content: 'probe ran',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };
  return {
    runner: LLMCall.create({ provider, model: 'mock' }).system('s').build(),
    calls: () => calls,
  };
}

/** The parts of the error a caller branches on. */
function failureOf(error: unknown) {
  if (!(error instanceof ReliabilityFailFastError)) {
    return { errorClass: error instanceof Error ? error.constructor.name : typeof error };
  }
  const cause = error.cause as Error | undefined;
  return {
    errorClass: 'ReliabilityFailFastError',
    kind: error.kind,
    reason: error.reason,
    message: error.message,
    payload: error.payload,
    cause: cause === undefined ? undefined : { name: cause.name, message: cause.message },
  };
}

async function settle(run: Promise<unknown>): Promise<{ returned?: unknown; error?: unknown }> {
  return run.then(
    (returned) => ({ returned }),
    (error: unknown) => ({ error }),
  );
}

interface Composed {
  readonly run: () => Promise<unknown>;
  readonly snapshot: () => Record<string, unknown>;
  /** Children after the failed one, which must not have run. */
  readonly later: readonly (() => number)[];
}

type Build = (ff: Agent) => Composed;

function composed(
  runner: { run(input: { message: string }): Promise<unknown>; getLastSnapshot(): unknown },
  later: readonly (() => number)[] = [],
): Composed {
  return {
    run: () => runner.run({ message: 'hello' }),
    snapshot: () =>
      ((runner.getLastSnapshot() as { sharedState?: Record<string, unknown> } | undefined)
        ?.sharedState ?? {}) as Record<string, unknown>,
    later,
  };
}

/** Compositions that hand a child's error on as it is. */
const PASS_THROUGH: Readonly<Record<string, Build>> = {
  'Sequence, first step': (ff) => {
    const next = probe();
    return composed(Sequence.create().step('a', ff).step('b', next.runner).build(), [next.calls]);
  },
  'Sequence, last step': (ff) =>
    composed(Sequence.create().step('a', probe().runner).step('b', ff).build()),
  Workflow: (ff) => {
    const next = probe();
    return composed(workflow(ff, next.runner), [next.calls]);
  },
  Conditional: (ff) =>
    composed(
      Conditional.create()
        .when('ff', () => true, ff)
        .otherwise('other', probe().runner)
        .build(),
    ),
  Loop: (ff) => composed(Loop.create().repeat(ff).times(3).build()),
};

describe('a composed agent that fails fast fails the composition', () => {
  for (const mode of MODES) {
    for (const [name, build] of Object.entries(PASS_THROUGH)) {
      it(`${name} raises the agent's own error (${mode})`, async () => {
        const direct = await settle(failFastAgent(mode).run('hello'));
        expect(failureOf(direct.error).errorClass).toBe('ReliabilityFailFastError');

        const composition = build(failFastAgent(mode));
        const settled = await settle(composition.run());
        expect(settled).not.toHaveProperty('returned');
        expect(failureOf(settled.error)).toEqual(failureOf(direct.error));
        // The record crossed the child's mount onto the composition's own state.
        expect(composition.snapshot().reliabilityFailKind).toBe(KIND);
        for (const calls of composition.later) expect(calls()).toBe(0);
      });
    }

    it(`Parallel reports a failed-fast branch as a failed branch (${mode})`, async () => {
      const strict = Parallel.create()
        .branch('ff', failFastAgent(mode))
        .branch('other', probe().runner)
        .mergeWithFn((results) => JSON.stringify(results))
        .build();
      const settled = await settle(strict.run({ message: 'hello' }));
      expect(settled).not.toHaveProperty('returned');
      expect(String((settled.error as Error).message)).toMatch(/ff: \[reliability\] composed-stop/);

      const tolerant = Parallel.create()
        .branch('ff', failFastAgent(mode))
        .branch('other', probe().runner)
        .mergeOutcomesWithFn((outcomes) => JSON.stringify(outcomes))
        .build();
      const outcomes = JSON.parse(String(await tolerant.run({ message: 'hello' }))) as Record<
        string,
        { ok: boolean; error?: string; value?: string }
      >;
      expect(outcomes.ff).toMatchObject({ ok: false });
      expect(outcomes.ff!.error).toContain(`[reliability] ${KIND}`);
      expect(outcomes.other).toEqual({ ok: true, value: 'probe ran' });
    });

    it(`Graph reports a failed-fast node as a failed node (${mode})`, async () => {
      const next = probe();
      const g = graph({
        id: 'g',
        nodes: [
          { id: 'ff', runner: failFastAgent(mode) },
          { id: 'next', runner: next.runner },
        ],
        edges: [{ from: 'ff', to: 'next' }],
      });
      const settled = await settle(g.run({ message: 'hello' }));
      expect(settled).not.toHaveProperty('returned');
      expect(String((settled.error as Error).message)).toContain(`[reliability] ${KIND}`);
      expect(String((settled.error as Error).message)).toContain('ff');
      expect(next.calls()).toBe(0);
    });
  }
});
