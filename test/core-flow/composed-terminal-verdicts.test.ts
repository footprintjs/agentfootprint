/**
 * A composed agent that ENDS on a terminal verdict fails the composition.
 *
 * An agent ends some runs on a record in its state instead of a throw — a
 * reliability fail-fast, a policy halt, a denied message (input or output), an
 * answer-validation refusal, an evidence-rails refusal — and only its own run
 * boundary (`Agent · finalizeResult`) raises the typed error. A composition
 * mounts the agent's CHART, so that boundary never runs: until this was fixed
 * the composition carried on as if the child had answered (`''`, the decider's
 * `'final'`, or the refused answer itself) — a silent wrong answer.
 *
 * The rule pinned here, for every verdict × every composition × all three
 * reactModes: the composition ends exactly as the standalone agent does. Where
 * a composition hands a child's error on as it is (Sequence, workflow,
 * Conditional, Loop) it raises the SAME error — class, message and payload —
 * and nothing after the child runs; where it reports failed children itself
 * (Parallel's merge, graph's level join) it reports this child failed with the
 * standalone error's message.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  Conditional,
  LLMCall,
  Loop,
  Parallel,
  Sequence,
  defineTool,
  deny,
  graph,
  workflow,
  type LLMProvider,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';

const MODES = ['classic', 'dynamic', 'dynamic-grouped'] as const;
type Mode = (typeof MODES)[number];

const lookup = defineTool({
  name: 'lookup',
  description: 'look it up',
  inputSchema: { type: 'object', properties: {} },
  execute: () => 'value 42',
});

/** Every way an agent's run can end on a record its boundary raises. */
const VERDICTS: Readonly<Record<string, (mode: Mode) => Agent>> = {
  'reliability fail-fast': (mode) =>
    Agent.create({
      provider: {
        name: 'upstream-failing',
        complete: async () => {
          throw new Error('upstream 500');
        },
      },
      model: 'mock',
      reactMode: mode,
    })
      .reliability({ postDecide: [{ when: () => true, then: 'fail-fast', kind: 'composed-stop' }] })
      .build(),
  'policy halt': (mode) =>
    Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 't1', name: 'lookup', args: {} }] }, { content: 'done' }],
      }),
      model: 'mock',
      reactMode: mode,
      permissionChecker: { name: 'halter', check: () => ({ result: 'halt', reason: 'test-stop' }) },
    })
      .tool(lookup)
      .build(),
  'message denied at input': (mode) =>
    Agent.create({ provider: mock({ reply: 'hi' }), model: 'mock', reactMode: mode })
      .act({ input: [{ name: 'gate', onMessage: () => deny('no input') }] })
      .build(),
  'message denied at output': (mode) =>
    Agent.create({ provider: mock({ reply: 'secret' }), model: 'mock', reactMode: mode })
      .act({ output: [{ name: 'gate', onMessage: () => deny('no output') }] })
      .build(),
  'answer validation refused': (mode) =>
    Agent.create({ provider: mock({ reply: '{"count":1}' }), model: 'mock', reactMode: mode })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'count',
        version: '1',
        mode: 'enforce',
        validate: () => ({ checks: [{ id: 'count', disposition: 'checked-fail' }] }),
      })
      .build(),
  'evidence rails refused': (mode) =>
    Agent.create({
      provider: mock({
        replies: [
          {
            content: '',
            toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
            stopReason: 'tool_use',
          },
          { content: 'The port is ZZZ-999 with id 0xdeadbe.' },
          { content: 'The port is ZZZ-999 with id 0xdeadbe.' },
        ],
      }),
      model: 'mock',
      reactMode: mode,
      maxIterations: 8,
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'rails' })
      .build(),
};

/**
 * A child that counts its runs, keeps the message it was handed, and answers
 * `hello` — what the agent is handed when it runs after it.
 */
function probe(): {
  readonly runner: LLMCall;
  readonly calls: () => number;
  readonly handed: () => string | undefined;
} {
  let calls = 0;
  let handed: string | undefined;
  const provider: LLMProvider = {
    name: 'probe',
    complete: async (request) => {
      calls += 1;
      const last = request.messages[request.messages.length - 1];
      handed = typeof last?.content === 'string' ? last.content : undefined;
      return {
        content: 'hello',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      };
    },
  };
  return {
    runner: LLMCall.create({ provider, model: 'mock' }).system('s').build(),
    calls: () => calls,
    handed: () => handed,
  };
}

/**
 * Runs that END ON AN ANSWER — the false positive's ground: a validated answer
 * leaves its chart as BreakFinal's `{ finalContent, answerValidationCommitted }`
 * and was read as the agent's state.
 */
const DELIVERED: Readonly<Record<string, (mode: Mode) => Agent>> = {
  'validated answer (enforce, passed)': (mode) =>
    Agent.create({ provider: mock({ reply: '{"n":1}' }), model: 'mock', reactMode: mode })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'n',
        version: '1',
        mode: 'enforce',
        validate: () => ({ checks: [{ id: 'n', disposition: 'checked-pass' }] }),
      })
      .build(),
  'validated answer (observe, check failed)': (mode) =>
    Agent.create({ provider: mock({ reply: '{"n":1}' }), model: 'mock', reactMode: mode })
      .outputSchema({ parse: (value: unknown) => value })
      .answerValidation({
        id: 'n',
        version: '1',
        mode: 'observe',
        validate: () => ({ checks: [{ id: 'n', disposition: 'checked-fail' }] }),
      })
      .build(),
  'evidence rails, grounded answer': (mode) =>
    Agent.create({
      // Looks the value up, then answers with it — on every run (a Loop reruns it).
      provider: {
        name: 'grounded',
        complete: async (request) =>
          request.messages[request.messages.length - 1]?.role === 'tool'
            ? {
                content: 'The value is 42.',
                toolCalls: [],
                usage: { input: 1, output: 1 },
                stopReason: 'end_turn',
              }
            : {
                content: '',
                toolCalls: [{ id: 't1', name: 'lookup', args: {} }],
                usage: { input: 1, output: 1 },
                stopReason: 'tool_use',
              },
      },
      model: 'mock',
      reactMode: mode,
      maxIterations: 8,
    })
      .tool(lookup)
      .namesAndNumbersFromEvidence({ posture: 'rails' })
      .build(),
};

/** What a caller can read off the error: class, message and every own field but the snapshot. */
function shapeOf(error: unknown) {
  if (!(error instanceof Error)) return { thrown: typeof error };
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (key === 'snapshot') continue;
    fields[key] = value instanceof Error ? { name: value.name, message: value.message } : value;
  }
  return { errorClass: error.constructor.name, message: error.message, fields };
}

async function rejection(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    (returned) => ({ resolvedWith: returned }),
    (error: unknown) => error,
  );
}

interface Composition {
  readonly run: () => Promise<unknown>;
  /** Children after the agent, which must never run. */
  readonly later: readonly (() => number)[];
}

const PASS_THROUGH: Readonly<Record<string, (agent: Agent) => Composition>> = {
  'Sequence, first step': (agent) => {
    const next = probe();
    const s = Sequence.create().step('a', agent).step('b', next.runner).build();
    return { run: () => s.run({ message: 'hello' }), later: [next.calls] };
  },
  'Sequence, last step': (agent) => {
    const s = Sequence.create().step('a', probe().runner).step('b', agent).build();
    return { run: () => s.run({ message: 'hello' }), later: [] };
  },
  workflow: (agent) => {
    const next = probe();
    const w = workflow(agent, next.runner);
    return { run: () => w.run({ message: 'hello' }), later: [next.calls] };
  },
  Conditional: (agent) => {
    const c = Conditional.create()
      .when('agent', () => true, agent)
      .otherwise('other', probe().runner)
      .build();
    return { run: () => c.run({ message: 'hello' }), later: [] };
  },
  Loop: (agent) => {
    const l = Loop.create().repeat(agent).times(3).build();
    return { run: () => l.run({ message: 'hello' }), later: [] };
  },
};

describe('a composed agent that ends on an answer hands the answer on', () => {
  for (const [delivered, make] of Object.entries(DELIVERED)) {
    for (const mode of MODES) {
      it(`${delivered} (${mode}): every composition carries the standalone answer`, async () => {
        const answer = await make(mode).run('hello');
        expect(typeof answer).toBe('string');

        const last = Sequence.create().step('a', probe().runner).step('b', make(mode)).build();
        expect(await last.run({ message: 'hello' })).toBe(answer);
        const first = probe();
        await Sequence.create()
          .step('a', make(mode))
          .step('b', first.runner)
          .build()
          .run({ message: 'hello' });
        expect(first.handed()).toBe(answer);
        const next = probe();
        await workflow(make(mode), next.runner).run({ message: 'hello' });
        expect(next.handed()).toBe(answer);
        const conditional = Conditional.create()
          .when('agent', () => true, make(mode))
          .otherwise('other', probe().runner)
          .build();
        expect(await conditional.run({ message: 'hello' })).toBe(answer);
        expect(
          await Loop.create().repeat(make(mode)).times(2).build().run({ message: 'hello' }),
        ).toBe(answer);
        const parallel = Parallel.create()
          .branch('agent', make(mode))
          .branch('other', probe().runner)
          .mergeWithFn((results) => JSON.stringify(results))
          .build();
        expect(JSON.parse(String(await parallel.run({ message: 'hello' })))).toEqual({
          agent: answer,
          other: 'hello',
        });
        const after = probe();
        const g = graph({
          id: 'g',
          nodes: [
            { id: 'agent', runner: make(mode) },
            { id: 'next', runner: after.runner },
          ],
          edges: [{ from: 'agent', to: 'next' }],
        });
        expect(await g.run({ message: 'hello' })).toMatchObject({ agent: answer });
        expect(after.handed()).toBe(answer);
      });
    }
  }
});

describe('a cancelled run inside a composition stays cancelled', () => {
  for (const mode of MODES) {
    it(`no retry, no reliability event, one call (${mode})`, async () => {
      for (const compose of [
        (agent: Agent) => Sequence.create().step('a', agent).step('b', probe().runner).build(),
        (agent: Agent) =>
          Parallel.create()
            .branch('a', agent)
            .branch('b', probe().runner)
            .mergeWithFn((results) => JSON.stringify(results))
            .build(),
        (agent: Agent) => Loop.create().repeat(agent).times(3).build(),
      ]) {
        const controller = new AbortController();
        let calls = 0;
        const agent = Agent.create({
          provider: {
            name: 'cancelling',
            complete: async () => {
              calls += 1;
              controller.abort();
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              throw error;
            },
          },
          model: 'mock',
          reactMode: mode,
        })
          .reliability({
            postDecide: [{ when: (s) => s.error !== undefined, then: 'retry', kind: 'r' }],
          })
          .build();
        const composition = compose(agent);
        const events: string[] = [];
        composition.on('*', (e: { type: string }) => {
          if (e.type.startsWith('agentfootprint.reliability.')) events.push(e.type);
        });
        const error = await composition
          .run({ message: 'hello' }, { signal: controller.signal })
          .then(
            () => undefined,
            (e: unknown) => e,
          );
        expect((error as Error | undefined)?.name).toBe('AbortError');
        expect(events).toEqual([]);
        // Settle anything the loop would still run in the background.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).toBe(1);
      }
    });
  }
});

describe('a composed agent that ends on a terminal verdict fails the composition', () => {
  for (const [verdict, make] of Object.entries(VERDICTS)) {
    for (const mode of MODES) {
      describe(`${verdict} (${mode})`, () => {
        for (const [name, compose] of Object.entries(PASS_THROUGH)) {
          it(`${name} raises the standalone error`, async () => {
            const standalone = shapeOf(await rejection(make(mode).run('hello')));
            expect(standalone).toHaveProperty('errorClass');
            const composition = compose(make(mode));
            expect(shapeOf(await rejection(composition.run()))).toEqual(standalone);
            for (const calls of composition.later) expect(calls()).toBe(0);
          });
        }

        it('Parallel reports the branch failed with the standalone message', async () => {
          const standalone = shapeOf(await rejection(make(mode).run('hello')));
          const strict = Parallel.create()
            .branch('agent', make(mode))
            .branch('other', probe().runner)
            .mergeWithFn((results) => JSON.stringify(results))
            .build();
          const failure = shapeOf(await rejection(strict.run({ message: 'hello' })));
          expect(failure.message).toContain(`agent: ${standalone.message}`);

          const tolerant = Parallel.create()
            .branch('agent', make(mode))
            .branch('other', probe().runner)
            .mergeOutcomesWithFn((outcomes) => JSON.stringify(outcomes))
            .build();
          const outcomes = JSON.parse(String(await tolerant.run({ message: 'hello' }))) as Record<
            string,
            unknown
          >;
          expect(outcomes.agent).toEqual({ ok: false, error: standalone.message });
          expect(outcomes.other).toEqual({ ok: true, value: 'hello' });
        });

        it('graph reports the node failed with the standalone message', async () => {
          const standalone = shapeOf(await rejection(make(mode).run('hello')));
          const next = probe();
          const g = graph({
            id: 'g',
            nodes: [
              { id: 'agent', runner: make(mode) },
              { id: 'next', runner: next.runner },
            ],
            edges: [{ from: 'agent', to: 'next' }],
          });
          const failure = shapeOf(await rejection(g.run({ message: 'hello' })));
          expect(failure.message).toContain(String(standalone.message));
          expect(failure.message).toContain("'agent'");
          expect(next.calls()).toBe(0);
        });
      });
    }
  }
});
