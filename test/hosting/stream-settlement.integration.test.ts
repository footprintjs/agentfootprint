import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  Conditional,
  defineTool,
  graph,
  isPaused,
  LLMCall,
  llmRouter,
  Loop,
  Parallel,
  pauseHere,
  selfConsistency,
  Sequence,
  swarm,
  workflow,
  type AgentOptions,
} from '../../src/index.js';
import { type MemoryDefinition } from '../../src/doors/memory.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { encodeSSE, toSSE, type ToSSEOptions } from '../../src/hosting/stream.js';

const END = 'agentfootprint.agent.turn_end';
const EXIT = 'agentfootprint.composition.exit';
const FATAL = 'agentfootprint.error.fatal';
const TOKEN = 'agentfootprint.stream.token';
const PAUSE = 'agentfootprint.pause.request';
const RESUME = 'agentfootprint.pause.resume';
const INPUT = { message: 'Begin.' };
const ROOT = 'The report is ready.';
const DRAFT = 'The draft is ready.';
const INNER_DRAFT = 'The inner draft is ready.';
const FIRST_ANSWER = 'First answer.';
const WARNING = '\n\n---\n\nNot sure — a tool reported unfinished work.';

type Mode = 'default' | 'start';
type Format = 'full' | 'text';
type NativeRunner = {
  on(type: '*', listener: (event: AgentfootprintEvent) => void): () => void;
  run(input: { message: string }): Promise<unknown>;
  drainObservers?(): Promise<unknown>;
  shutdown(): Promise<unknown>;
};

/** Bound any legacy wait, and let a slow consumer leave frames in the native stream's queue. */
async function observe(
  runner: NativeRunner,
  mode: Mode,
  format: Format,
  invoke = () => runner.run(INPUT),
  filter?: ToSSEOptions['filter'],
  slow = false,
) {
  const events: AgentfootprintEvent[] = [];
  const off = runner.on('*', (event) => events.push(event));
  let drained = false;
  let started = false;
  const invocation = Promise.withResolvers<{ value: Promise<unknown> }>();
  const backlog = Promise.withResolvers<void>();
  const start = () => {
    started = true;
    const value = invoke();
    invocation.resolve({ value });
    return value;
  };
  const options = {
    format,
    heartbeatMs: 50,
    filter,
    ...(mode === 'start' && { start }),
  };
  const reading = (async () => {
    const chunks: string[] = [];
    for await (const chunk of toSSE(runner, options)) {
      if (chunk === ': ping\n\n') {
        if (drained || !started) return { closed: false, chunks };
        continue;
      }
      chunks.push(chunk);
      if (slow && chunks.length === 1) await backlog.promise;
    }
    return { closed: true, chunks };
  })();
  try {
    if (mode === 'default') start();
    const owner = await Promise.race([invocation.promise, reading.then(() => undefined)]);
    if (owner === undefined) throw new Error('The stream did not start its native invocation');
    const [outcome] = await Promise.allSettled([owner.value]);
    if (mode === 'default') await runner.drainObservers?.();
    drained = true;
    backlog.resolve();
    const stream = await reading;
    // Count late events for expectations only after the opted-in stream has actually ended.
    await runner.drainObservers?.();
    return { ...stream, outcome, events };
  } finally {
    drained = true;
    backlog.resolve();
    await reading;
    off();
  }
}

function streaming(...replies: string[]) {
  return Agent.create({ provider: mock({ replies, chunkDelayMs: 0 }), model: 'm' }).build();
}

function completeOnly(answer: string) {
  return LLMCall.create({ provider: mock({ reply: answer }), model: 'm' }).build();
}

const pendingReport = defineTool({
  name: 'pending_report',
  description: 'Check if the report is ready.',
  inputSchema: { type: 'object', properties: {} },
  execute: () => ({ content: 'Queued.', effects: [], status: 'pending' }),
});

function reportBuilder(observerDelivery: AgentOptions['observerDelivery'] = 'inline') {
  return Agent.create({
    provider: mock({
      replies: [{ toolCalls: [{ id: 'c1', name: 'pending_report', args: {} }] }, ROOT],
      chunkDelayMs: 0,
    }),
    model: 'm',
    observerDelivery,
  })
    .tool(pendingReport)
    .answerLayer({ standingLine: true });
}

function specialistMemory(child: Agent): MemoryDefinition {
  const read = flowChart('Seed', () => undefined, 'seed')
    .addSubFlowChartNext('specialist', child.getSpec(), 'Specialist', {
      inputMapper: () => ({
        message: 'Check the draft.',
        identity: { conversationId: 'specialist' },
      }),
      outputMapper: () => ({ formatted: 'The specialist finished.' }),
    })
    .build();
  return {
    id: 'nested',
    type: 'episodic',
    timing: 'turn-start',
    read: read as unknown as MemoryDefinition['read'],
  };
}

function routeToTwoMembers(halt = false) {
  return swarm({
    agents: [
      { id: 'a', runner: streaming('Alpha.') },
      { id: 'b', runner: streaming('Beta.') },
    ],
    route: ({ message }) => (halt ? undefined : message === INPUT.message ? 'a' : 'b'),
    maxHandoffs: 2,
  });
}

const predicate = (selected: boolean) =>
  Conditional.create()
    .when('selected', () => selected, streaming('Selected.'))
    .otherwise('fallback', streaming('Fallback.'))
    .build();

const formats = ['full', 'text'] as const;
const modes = ['default', 'start'] as const;
const modesAndFormats = modes.flatMap((mode) => formats.map((format) => [mode, format] as const));

const shapes = [
  {
    name: 'Sequence',
    answer: 'Second answer.',
    ends: 2,
    legacyFirstStepOnly: true,
    make: () =>
      Sequence.create()
        .step('first', streaming(FIRST_ANSWER))
        .step('second', streaming('Second answer.'))
        .build(),
  },
  {
    name: 'nested Sequence',
    answer: 'Outer answer.',
    ends: 3,
    slow: true,
    make: () =>
      Sequence.create()
        .step(
          'nested',
          Sequence.create()
            .step('first', streaming('First answer.'))
            .step('second', streaming('Inner answer.'))
            .build(),
        )
        .step('outer', streaming('Outer answer.'))
        .build(),
  },
  {
    name: 'first step mounts an Agent',
    answer: 'Final answer.',
    ends: 3,
    make: () =>
      Sequence.create()
        .step(
          'first',
          reportBuilder()
            .memory(specialistMemory(streaming(DRAFT)))
            .build(),
        )
        .step('last', streaming('Final answer.'))
        .build(),
  },
  {
    name: 'second step mounts an Agent',
    answer: ROOT + WARNING,
    ends: 3,
    turnAnswers: [FIRST_ANSWER, DRAFT, ROOT + WARNING],
    legacyFirstStepOnly: true,
    make: () =>
      Sequence.create()
        .step('first', streaming(FIRST_ANSWER))
        .step(
          'second',
          reportBuilder()
            .memory(specialistMemory(streaming(DRAFT)))
            .build(),
        )
        .build(),
  },
  {
    name: 'Parallel function merge',
    answer: 'Alpha. + Beta.',
    ends: 2,
    make: () =>
      Parallel.create()
        .branch('a', streaming('Alpha.'))
        .branch('b', streaming('Beta.'))
        .mergeWithFn((answers) => `${answers.a} + ${answers.b}`)
        .build(),
  },
  {
    name: 'Parallel LLM merge',
    answer: 'Merged in the model.',
    ends: 2,
    make: () =>
      Parallel.create()
        .branch('a', streaming('Alpha.'))
        .branch('b', streaming('Beta.'))
        .mergeWithLLM({
          provider: mock({ reply: 'Merged in the model.' }),
          model: 'm',
          prompt: 'Merge.',
        })
        .build(),
  },
  {
    name: 'Parallel tolerated branch failure',
    answer: 'Kept Alpha.',
    ends: 1,
    make: () =>
      Parallel.create()
        .branch('a', streaming('Alpha.'))
        .branch(
          'b',
          LLMCall.create({
            provider: {
              name: 'broken',
              async complete() {
                throw new Error('Optional provider failed.');
              },
            },
            model: 'm',
          }).build(),
        )
        .mergeOutcomesWithFn((outcomes) =>
          outcomes.b?.ok === false ? 'Kept Alpha.' : 'Unexpected outcome.',
        )
        .build(),
  },
  { name: 'Conditional selected arm', answer: 'Selected.', ends: 1, make: () => predicate(true) },
  { name: 'Conditional fallback', answer: 'Fallback.', ends: 1, make: () => predicate(false) },
  {
    name: 'Loop guard',
    answer: 'Last pass.',
    ends: 2,
    make: () =>
      Loop.create()
        .repeat(streaming('First pass.', 'Last pass.'))
        .times(3)
        .until(({ iteration }) => iteration === 2)
        .build(),
  },
  {
    name: 'Loop budget',
    answer: 'Last pass.',
    ends: 2,
    make: () => Loop.create().repeat(streaming('First pass.', 'Last pass.')).times(2).build(),
  },
  { name: 'Swarm handoff', answer: 'Beta.', ends: 2, make: () => routeToTwoMembers() },
  {
    name: 'Swarm immediate halt',
    answer: INPUT.message,
    ends: 0,
    make: () => routeToTwoMembers(true),
  },
  {
    name: 'Graph output map',
    answer: { left: 'Left.', right: 'Right.' },
    ends: 0,
    make: () =>
      graph({
        nodes: [
          { id: 'left', runner: completeOnly('Left.') },
          { id: 'right', runner: completeOnly('Right.') },
        ],
        edges: [],
      }),
  },
  {
    name: 'Workflow structured routing decision',
    answer: { message: 'Structured result.' },
    ends: 0,
    make: () =>
      workflow(
        llmRouter({
          provider: mock({ reply: '{"message":"Structured result."}' }),
          model: 'm',
          agents: [
            { id: 'x', description: 'X.' },
            { id: 'y', description: 'Y.' },
          ],
        }).step,
      ),
  },
  {
    name: 'LLMCall-only recipe',
    answer: 'Voted result.',
    ends: 0,
    make: () =>
      selfConsistency({
        provider: mock({ reply: 'Voted result.' }),
        samples: 2,
        model: 'm',
        systemPrompt: 'Vote.',
      }),
  },
] satisfies readonly {
  name: string;
  answer: unknown;
  ends: number;
  turnAnswers?: string[];
  legacyFirstStepOnly?: boolean;
  slow?: boolean;
  make: () => NativeRunner;
}[];

function frames(events: readonly AgentfootprintEvent[]): string[] {
  return events.map((event) => encodeSSE(event.type, event));
}

function tokens(events: readonly AgentfootprintEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === TOKEN && event.payload.content ? [event.payload.content] : [],
  );
}

function expectAll(
  observed: Awaited<ReturnType<typeof observe>>,
  format: Format,
  events = observed.events,
) {
  expect(observed.closed).toBe(true);
  expect(observed.chunks).toEqual(format === 'full' ? frames(events) : tokens(events));
}

/** The old boundary triggers at one end, with any events already admitted still drainable. */
function expectDefault(
  observed: Awaited<ReturnType<typeof observe>>,
  format: Format,
  firstEndOnly = false,
) {
  const firstEnd = observed.events.findIndex((event) => event.type === END || event.type === FATAL);
  expect(observed.closed).toBe(firstEnd >= 0);
  const expected = format === 'full' ? frames(observed.events) : tokens(observed.events);
  expect(observed.chunks).toEqual(expected.slice(0, observed.chunks.length));
  const throughEnd = firstEnd < 0 ? observed.events : observed.events.slice(0, firstEnd + 1);
  const required = format === 'full' ? frames(throughEnd) : tokens(throughEnd);
  expect(firstEndOnly ? observed.chunks : observed.chunks.slice(0, required.length)).toEqual(
    required,
  );
}

describe('toSSE on native compositions', () => {
  it.each(
    shapes.flatMap((shape) =>
      modesAndFormats.map(([mode, format]) => ({ shape, name: shape.name, mode, format })),
    ),
  )('$name $mode $format', async ({ shape, mode, format }) => {
    const runner = shape.make();
    try {
      const observed = await observe(
        runner,
        mode,
        format,
        undefined,
        undefined,
        mode === 'start' && format === 'full' && shape.slow,
      );
      expect(observed.outcome).toEqual({ status: 'fulfilled', value: shape.answer });
      const ends = observed.events.filter((event) => event.type === END);
      expect(ends).toHaveLength(shape.ends);
      if (shape.turnAnswers) {
        expect(ends.map((event) => event.payload.finalContent)).toEqual(shape.turnAnswers);
      }
      expect(observed.events.some((event) => event.type === FATAL)).toBe(false);
      if (mode === 'start') expectAll(observed, format);
      else expectDefault(observed, format, shape.legacyFirstStepOnly);
      if (mode === 'start' && format === 'full' && shape.legacyFirstStepOnly) {
        expect(observed.events.at(-1)?.type).toBe(EXIT);
      }
      if (mode === 'default' && format === 'text' && shape.legacyFirstStepOnly) {
        expect(observed.chunks).toEqual(['First ', 'answer.']);
      }
    } finally {
      await runner.shutdown();
    }
  });
});

describe('toSSE across native invocation outcomes', () => {
  it.each(modesAndFormats)('rejects on the caller promise in %s %s', async (mode, format) => {
    const failure = new Error('The second step failed.');
    const runner = Sequence.create()
      .step('first', streaming('First answer.'))
      .pipeVia(() => {
        throw failure;
      })
      .step('second', completeOnly('Never called.'))
      .build();
    try {
      const observed = await observe(runner, mode, format);
      expect(observed.outcome).toEqual({ status: 'rejected', reason: failure });
      if (mode === 'start') expectAll(observed, format);
      else expectDefault(observed, format);
    } finally {
      await runner.shutdown();
    }
  });

  const approval = defineTool({
    name: 'request_approval',
    description: 'Wait for an approval.',
    inputSchema: { type: 'object', properties: {} },
    execute: () => pauseHere({ question: 'Approve?' }),
  });
  const pauseRows = modesAndFormats.flatMap(([mode, format]) => [
    { mode, format, afterChild: false },
    { mode, format, afterChild: true },
  ]);

  it.each(pauseRows)(
    'separate paused and resumed legs in $mode $format (first child ends first: $afterChild)',
    async ({ mode, format, afterChild }) => {
      const pausing = Agent.create({
        provider: mock({
          replies: [
            { toolCalls: [{ id: 'first', name: approval.schema.name, args: {} }] },
            { toolCalls: [{ id: 'second', name: approval.schema.name, args: {} }] },
            'Approved.',
          ],
          chunkDelayMs: 0,
        }),
        model: 'm',
      })
        .tool(approval)
        .build();
      const builder = Sequence.create();
      if (afterChild) builder.step('before', streaming('Before approval.'));
      const runner = builder
        .step('approve', pausing)
        .step('after', streaming('Final answer.'))
        .build();
      try {
        const first = await observe(runner, mode, format);
        if (first.outcome.status !== 'fulfilled' || !isPaused(first.outcome.value)) {
          throw new Error('The first leg should request approval');
        }
        const firstCheckpoint = first.outcome.value.checkpoint;
        const second = await observe(runner, mode, format, () =>
          runner.resume(firstCheckpoint, { approved: true }),
        );
        if (second.outcome.status !== 'fulfilled' || !isPaused(second.outcome.value)) {
          throw new Error('The first resume should request another approval');
        }
        const secondCheckpoint = second.outcome.value.checkpoint;
        const last = await observe(runner, mode, format, () =>
          runner.resume(secondCheckpoint, { approved: true }),
        );

        expect(first.events.filter((event) => event.type === END)).toHaveLength(afterChild ? 1 : 0);
        expect(first.events.filter((event) => event.type === PAUSE)).toHaveLength(1);
        expect(second.events.filter((event) => event.type === RESUME)).toHaveLength(1);
        expect(second.events.filter((event) => event.type === PAUSE)).toHaveLength(1);
        expect(second.events.filter((event) => event.type === END)).toEqual([]);
        expect(last.events.filter((event) => event.type === RESUME)).toHaveLength(1);
        expect(last.events.some((event) => event.type === PAUSE)).toBe(false);
        expect(last.outcome).toEqual({ status: 'fulfilled', value: 'Final answer.' });
        for (const leg of [first, second, last]) {
          if (mode === 'start') expectAll(leg, format);
          else expectDefault(leg, format);
        }
      } finally {
        await Promise.all([runner.shutdown(), pausing.shutdown()]);
      }
    },
  );
});

describe('toSSE with served records and the owning Agent', () => {
  it.each(
    modesAndFormats.flatMap(([mode, format]) =>
      [0, 1, 2].map((mountDepth) => ({ mode, format, mountDepth })),
    ),
  )(
    'keeps the owning answer in $mode $format (mount depth: $mountDepth)',
    async ({ mode, format, mountDepth }) => {
      const inner = mountDepth === 2 ? streaming(INNER_DRAFT) : undefined;
      const childBuilder = Agent.create({
        provider: mock({ reply: DRAFT, chunkDelayMs: 0 }),
        model: 'm',
      });
      const child =
        mountDepth === 0
          ? undefined
          : (inner ? childBuilder.memory(specialistMemory(inner)) : childBuilder).build();
      const builder = reportBuilder(child ? 'deferred' : 'inline');
      const runner = (child ? builder.memory(specialistMemory(child)) : builder).build();
      try {
        // Only the one-level control filters the root end. The two-level case
        // keeps all three ends and the owning text suffix.
        const filter = (event: AgentfootprintEvent) =>
          mountDepth !== 1 || event.type !== END || event.meta.rootTurn !== true;
        const observed = await observe(runner, mode, format, undefined, filter);
        expect(observed.outcome).toEqual({ status: 'fulfilled', value: ROOT + WARNING });
        expect(observed.closed).toBe(true);
        const ends = observed.events.filter((event) => event.type === END);
        const drafts = [DRAFT, INNER_DRAFT].slice(0, mountDepth).reverse();
        expect(ends.map((event) => event.payload.finalContent)).toEqual([
          ...drafts,
          ROOT + WARNING,
        ]);
        expect(ends.map((event) => event.meta.rootTurn)).toEqual([
          ...drafts.map(() => undefined),
          true,
        ]);
        expect(ends.map((event) => event.meta.mountedTurn)).toEqual([
          ...drafts.map(() => true),
          undefined,
        ]);
        if (format === 'text') {
          expect(observed.chunks).toEqual([
            'The ',
            'report ',
            'is ',
            'ready.',
            ...(mountDepth !== 1 ? [WARNING] : []),
          ]);
        } else {
          const admitted = observed.events.filter(filter);
          const expected = frames(admitted);
          expect(observed.chunks).toEqual(
            mode === 'start' ? expected : expected.slice(0, observed.chunks.length),
          );
          expect(observed.chunks.filter((frame) => frame.startsWith(`event: ${END}\n`))).toEqual(
            frames(ends.filter(filter)),
          );
          expect(observed.chunks.some((frame) => frame.includes('"content":"report "'))).toBe(true);
          if (child) {
            expect(observed.chunks.some((frame) => frame.includes('"content":"draft "'))).toBe(
              true,
            );
          }
          if (inner) {
            const [innerEnd, childEnd] = ends;
            expect(innerEnd!.meta.subflowPath.length).toBeGreaterThan(
              childEnd!.meta.subflowPath.length,
            );
            expect(observed.chunks.some((frame) => frame.includes('"content":"inner "'))).toBe(
              true,
            );
          }
        }
      } finally {
        await Promise.all([runner.shutdown(), child?.shutdown(), inner?.shutdown()]);
      }
    },
  );

  it.each(formats)(
    'uses served native tokens in start %s and keeps hidden answers on the caller promise',
    async (format) => {
      const views: { types: string[]; frameCount: number; contents: string[] }[] = [];
      const hidden = ['PrivateAlpha', 'PrivateOmega'];
      for (const answer of hidden) {
        const runner = Sequence.create()
          .step(
            'member',
            Agent.create({
              provider: mock({ reply: answer, chunkDelayMs: 0 }),
              model: 'm',
              redact: conversationRedaction(),
            }).build(),
          )
          .build();
        try {
          const observed = await observe(runner, 'start', format);
          expect(observed.outcome).toEqual({ status: 'fulfilled', value: answer });
          expectAll(observed, format);
          expect(tokens(observed.events)).toEqual(['[REDACTED]']);
          for (const secret of hidden) expect(observed.chunks.join('')).not.toContain(secret);
          views.push({
            types: observed.events.map((event) => event.type),
            frameCount: observed.chunks.length,
            contents: tokens(observed.events),
          });
        } finally {
          await runner.shutdown();
        }
      }
      expect(views[0]).toEqual(views[1]);
    },
  );
});
