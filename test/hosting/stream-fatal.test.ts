import { describe, expect, it, vi } from 'vitest';
import { Agent, Conditional, LLMCall, Parallel, Sequence } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { encodeSSE, type ToSSEOptions } from '../../src/hosting/stream.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { readWithHeartbeat, specialistMemory } from '../helpers/hostingStreams.js';

const FATAL = 'agentfootprint.error.fatal';
const TURN_END = 'agentfootprint.agent.turn_end';
const DRAFT = 'The draft is ready.';

type Runner = Parameters<typeof readWithHeartbeat>[0] & {
  run(input: { message: string }): Promise<unknown>;
  drainObservers?(): Promise<unknown>;
  shutdown(): Promise<unknown>;
};

async function observe(runner: Runner, filter?: ToSSEOptions['filter']) {
  const events: AgentfootprintEvent[] = [];
  const off = runner.on('*', (event) => events.push(event));
  const full = readWithHeartbeat(runner, { format: 'full', filter });
  const text = readWithHeartbeat(runner, { format: 'text', filter });
  try {
    const [run] = await Promise.allSettled([runner.run({ message: 'Is the report ready?' })]);
    await runner.drainObservers?.();
    const [fullStream, textStream] = await Promise.all([full(), text()]);
    return { events, run, full: fullStream, text: textStream };
  } finally {
    off();
    await Promise.all([full(), text()]);
    await runner.shutdown();
  }
}

function down(message: string): LLMProvider {
  return {
    name: 'failing-provider',
    async complete() {
      throw new Error(message);
    },
  };
}

function answerWith(answer: string) {
  return Agent.create({ provider: mock({ reply: answer, chunkDelayMs: 0 }), model: 'm' });
}

// The callbacks must fail before any Agent end can make the stream look closed.
// LLMCall runs a real chart and returns text without emitting agent.turn_end.
function completeOnly(answer: string) {
  return LLMCall.create({ provider: mock({ reply: answer }), model: 'm' }).build();
}

function failsFirst(message: string, privateFailure = false) {
  return Sequence.create()
    .step(
      'first',
      Agent.create({
        provider: down(message),
        model: 'm',
        ...(privateFailure && { redact: conversationRedaction() }),
      }).build(),
    )
    .step('later', completeOnly('Never runs.'))
    .build();
}

function expectFatal(observed: Awaited<ReturnType<typeof observe>>) {
  expect([observed.full.closed, observed.text.closed]).toEqual([true, true]);
  expect(observed.text.chunks).toEqual([]);
  const fatal = observed.events.filter((event) => event.type === FATAL);
  expect(fatal).toHaveLength(1);
  expect(observed.full.chunks.filter((chunk) => chunk.startsWith(`event: ${FATAL}\n`))).toEqual(
    fatal.map((event) => encodeSSE(event.type, event)),
  );
  expect(observed.full.chunks.at(-1)).toBe(encodeSSE(FATAL, fatal[0]));
}

describe('toSSE — a failed composition closes the default stream', () => {
  it.each([
    ['first provider', 'provider down', () => failsFirst('provider down')],
    [
      'mapper',
      'mapper failed',
      () =>
        Sequence.create()
          .step('first', completeOnly('Mapped string.'))
          .pipeVia(() => {
            throw new Error('mapper failed');
          })
          .step('second', completeOnly('Never runs.'))
          .build(),
    ],
    [
      'predicate',
      'predicate failed',
      () =>
        Conditional.create()
          .when(
            'test',
            () => {
              throw new Error('predicate failed');
            },
            completeOnly('Never runs.'),
          )
          .otherwise('fallback', completeOnly('Never runs either.'))
          .build(),
    ],
    [
      'merge',
      'merge failed',
      () =>
        Parallel.create()
          .branch('left', completeOnly('Left.'))
          .branch('right', completeOnly('Right.'))
          .mergeWithFn(() => {
            throw new Error('merge failed');
          })
          .build(),
    ],
    [
      'strict branch',
      'branch provider down',
      () =>
        Parallel.create()
          .branch('healthy', completeOnly('Healthy branch.'))
          .branch(
            'failed',
            LLMCall.create({ provider: down('branch provider down'), model: 'm' }).build(),
          )
          .mergeWithFn(() => 'Never merged.')
          .build(),
    ],
  ] as const)('%s failure releases both streams', async (_shape, message, makeRunner) => {
    const observed = await observe(makeRunner());
    expect(observed.run).toMatchObject({
      status: 'rejected',
      reason: { message: expect.stringContaining(message) },
    });
    expect(observed.events.some((event) => event.type === TURN_END)).toBe(false);
    expectFatal(observed);
  });

  it.each(['drop', 'throw'] as const)(
    'a filter can %s on the fatal without holding either stream open',
    async (mode) => {
      let fatalsSeen = 0;
      const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const observed = await observe(failsFirst('provider down'), (event) => {
          if (event.type === FATAL) {
            fatalsSeen += 1;
            if (mode === 'throw') throw new Error('filter failed');
          }
          return false;
        });
        expect(observed.run.status).toBe('rejected');
        expect(observed.full).toEqual({ closed: true, chunks: [] });
        expect(observed.text).toEqual({ closed: true, chunks: [] });
        expect(fatalsSeen).toBe(2);
        expect(observed.events.filter((event) => event.type === FATAL)).toHaveLength(1);
      } finally {
        logger.mockRestore();
      }
    },
  );

  it('paired provider errors keep their private details on the caller side', async () => {
    const secrets = ['private-detail-alpha', 'private-detail-omega'];
    const observations = [];
    for (const secret of secrets) {
      const observed = await observe(failsFirst(`provider down for ${secret}`, true));
      expect(observed.run).toMatchObject({
        status: 'rejected',
        reason: { message: expect.stringContaining(secret) },
      });
      expectFatal(observed);
      const served = observed.events.filter((event) => event.type === FATAL);
      const servedRecord = observed.events.map((event) => encodeSSE(event.type, event)).join('');
      for (const value of secrets) {
        expect(servedRecord).not.toContain(value);
        expect(observed.full.chunks.join('')).not.toContain(value);
      }
      observations.push({
        eventTypes: observed.events.map((event) => event.type),
        fullFrameCount: observed.full.chunks.length,
        textFrameCount: observed.text.chunks.length,
        served: served.map((event) => event.payload),
      });
    }
    expect(observations[0]).toEqual(observations[1]);
  });

  it('a tolerated optional branch failure keeps the successful record and default stream behavior', async () => {
    const runner = Parallel.create()
      .branch('healthy', completeOnly('Healthy branch.'), { required: true })
      .branch(
        'optional',
        LLMCall.create({ provider: down('optional failure'), model: 'm' }).build(),
      )
      .mergeOutcomesWithFn((outcomes) => {
        expect(outcomes.optional).toMatchObject({ ok: false });
        return 'Merged successfully.';
      })
      .build();
    const observed = await observe(runner);
    expect(observed.run).toEqual({ status: 'fulfilled', value: 'Merged successfully.' });
    expect(
      observed.events.find((event) => event.type === 'agentfootprint.composition.exit'),
    ).toMatchObject({ payload: { status: 'ok' } });
    expect(observed.events.some((event) => event.type === FATAL)).toBe(false);
    expect(observed.text).toEqual({ closed: false, chunks: [] });
    expect(observed.full).toEqual({
      closed: false,
      chunks: observed.events.map((event) => encodeSSE(event.type, event)),
    });
  });
});

describe('toSSE — existing Agent failure boundaries', () => {
  it.each(['plain', 'mounted provider fails', 'root fails after mounted answer'] as const)(
    '%s closes both formats with one fatal event',
    async (shape) => {
      const child =
        shape === 'plain'
          ? undefined
          : shape === 'mounted provider fails'
          ? Agent.create({ provider: down('provider down'), model: 'm' }).build()
          : answerWith(DRAFT).build();
      const builder =
        shape === 'mounted provider fails'
          ? answerWith('Root should never run.')
          : Agent.create({ provider: down('provider down'), model: 'm' });
      const root =
        child === undefined ? builder.build() : builder.memory(specialistMemory(child)).build();
      try {
        const observed = await observe(root);
        expect(observed.run).toMatchObject({
          status: 'rejected',
          reason: { message: 'provider down' },
        });
        expectFatal(observed);
        const ends = observed.events.filter((event) => event.type === TURN_END);
        if (shape === 'root fails after mounted answer') {
          expect(ends).toEqual([
            expect.objectContaining({
              payload: expect.objectContaining({ finalContent: DRAFT }),
              meta: expect.objectContaining({ mountedTurn: true }),
            }),
          ]);
          expect(observed.full.chunks).toContain(encodeSSE(TURN_END, ends[0]));
        } else {
          expect(ends).toEqual([]);
        }
      } finally {
        await child?.shutdown();
      }
    },
  );
});
