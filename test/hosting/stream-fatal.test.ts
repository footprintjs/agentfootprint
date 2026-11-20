import type { CombinedRecorder, FlowRunFailedEvent } from 'footprintjs';
import { describe, expect, it, vi } from 'vitest';
import { Agent, Conditional, LLMCall, Parallel, Sequence } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { encodeSSE, type ToSSEOptions } from '../../src/hosting/stream.js';
import { LLM_ERROR_SENTENCES } from '../../src/lib/humanizeLLMError.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { readWithHeartbeat, specialistMemory } from '../helpers/hostingStreams.js';

const FATAL = 'agentfootprint.error.fatal';
const TURN_END = 'agentfootprint.agent.turn_end';
const DRAFT = 'The draft is ready.';

type Runner = Parameters<typeof readWithHeartbeat>[0] & {
  run(input: { message: string }, options?: { signal?: AbortSignal }): Promise<unknown>;
  attach(recorder: CombinedRecorder): () => void;
  drainObservers?(): Promise<unknown>;
  shutdown(): Promise<unknown>;
};

async function observe(runner: Runner, filter?: ToSSEOptions['filter'], signal?: AbortSignal) {
  const events: AgentfootprintEvent[] = [];
  const failures: FlowRunFailedEvent[] = [];
  const off = runner.on('*', (event) => events.push(event));
  const detach = runner.attach({
    id: 'stream-fatal-native',
    onRunFailed: (failure) => void failures.push(failure),
  });
  const full = readWithHeartbeat(runner, { format: 'full', filter });
  const text = readWithHeartbeat(runner, { format: 'text', filter });
  try {
    const [run] = await Promise.allSettled([
      runner.run(
        { message: 'Is the report ready?' },
        signal === undefined ? undefined : { signal },
      ),
    ]);
    await runner.drainObservers?.();
    const [fullStream, textStream] = await Promise.all([full(), text()]);
    return { events, failures, run, full: fullStream, text: textStream };
  } finally {
    off();
    detach();
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

function answerWith(answer: string, redact = false) {
  return Agent.create({
    provider: mock({ reply: answer, chunkDelayMs: 0 }),
    model: 'm',
    ...(redact && { redact: conversationRedaction() }),
  });
}

// The callbacks must fail before any Agent end can make the stream look closed.
// LLMCall runs a real chart and returns text without emitting agent.turn_end.
function completeOnly(answer: string) {
  return LLMCall.create({ provider: mock({ reply: answer }), model: 'm' }).build();
}

function failingAgent(message: string, redact = false) {
  return Agent.create({
    provider: down(message),
    model: 'm',
    ...(redact && { redact: conversationRedaction() }),
  }).build();
}

function failsFirst(message: string, redactedMember?: 'first' | 'later') {
  return Sequence.create()
    .step('first', failingAgent(message, redactedMember === 'first'))
    .step(
      'later',
      redactedMember === 'later'
        ? answerWith('Never runs.', true).build()
        : completeOnly('Never runs.'),
    )
    .build();
}

function failsInMapper(reason: unknown) {
  return Sequence.create()
    .step('first', completeOnly('Mapped string.'))
    .pipeVia(() => {
      throw reason;
    })
    .step('second', completeOnly('Never runs.'))
    .build();
}

type Observation = Awaited<ReturnType<typeof observe>>;

function terminalFacts(observed: Observation) {
  const fatals = observed.events.filter((event) => event.type === FATAL);
  expect(fatals).toHaveLength(1);
  expect(observed.failures).toHaveLength(1);
  const [fatal] = fatals;
  const [failure] = observed.failures;
  expect(fatal.meta.runId).toBe(failure.traversalContext?.runId);
  return { fatal, failure };
}

function expectFatal(observed: Observation) {
  expect([observed.full.closed, observed.text.closed]).toEqual([true, true]);
  expect(observed.text.chunks).toEqual([]);
  const facts = terminalFacts(observed);
  const fatalFrame = encodeSSE(FATAL, facts.fatal);
  expect(observed.full.chunks.filter((chunk) => chunk.startsWith(`event: ${FATAL}\n`))).toEqual([
    fatalFrame,
  ]);
  expect(observed.full.chunks.at(-1)).toBe(fatalFrame);
  return facts;
}

describe('toSSE — a failed composition closes the default stream', () => {
  it.each([
    ['first provider', 'provider down', () => failsFirst('provider down')],
    ['mapper', 'mapper failed', () => failsInMapper(new Error('mapper failed'))],
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
    [
      'nested Sequence',
      'nested provider down',
      () => Sequence.create().step('inner', failsFirst('nested provider down')).build(),
    ],
    [
      'selected Conditional branch',
      'selected provider down',
      () =>
        Conditional.create()
          .when('selected', () => true, failingAgent('selected provider down'))
          .otherwise('fallback', completeOnly('Never runs.'))
          .build(),
    ],
    [
      'both strict branches',
      '2 branch(es) failed',
      () =>
        Parallel.create()
          .branch('left', failingAgent('left failed'))
          .branch('right', failingAgent('right failed'))
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
    const { fatal, failure } = expectFatal(observed);
    expect(fatal.payload.error).toBe(`The run failed: ${failure.structuredError.message}`);
  });

  it('reports one failure when a Sequence fails after an earlier Agent answers', async () => {
    const observed = await observe(
      Sequence.create()
        .step('first', answerWith('First answer.').build())
        .step('second', failingAgent('second provider down'))
        .build(),
    );
    const { fatal, failure } = terminalFacts(observed);
    expect(fatal.payload.error).toBe(`The run failed: ${failure.structuredError.message}`);
    expect(observed.events.filter((event) => event.type === TURN_END)).toHaveLength(1);
    expect(observed.full.closed).toBe(true);
    expect(observed.text).toEqual({ closed: true, chunks: ['First ', 'answer.'] });
  });

  const brokenGetter = {
    get message(): never {
      throw new Error('unreadable message');
    },
  };

  it.each([
    ['string', 'plain string thrown', 'plain string thrown'],
    ['null', null, 'null'],
    ['an object with a throwing message getter', brokenGetter, '[object Object]'],
  ] as const)(
    'uses the native failure for a mapper throwing %s',
    async (_label, reason, message) => {
      const observed = await observe(failsInMapper(reason));
      expect(observed.run).toEqual({ status: 'rejected', reason });
      const { fatal, failure } = expectFatal(observed);
      expect(failure.structuredError.message).toBe(message);
      expect(fatal.payload.error).toBe(`The run failed: ${message}`);
    },
  );

  it('keeps a mapper error cause out of the served frame', async () => {
    const cause = new Error('private cause detail');
    const reason = new Error('lookup failed', { cause });
    const observed = await observe(failsInMapper(reason));
    expect(observed.run).toEqual({ status: 'rejected', reason });
    const { fatal, failure } = expectFatal(observed);
    expect(fatal.payload.error).toBe(`The run failed: ${failure.structuredError.message}`);
    expect(observed.full.chunks.join('')).not.toContain(cause.message);
  });

  it('reports the caller cancelling an admitted run as a run failure', async () => {
    const cancellation = new AbortController();
    const provider: LLMProvider = {
      name: 'cancelled-provider',
      async complete(request) {
        cancellation.abort();
        request.signal?.throwIfAborted();
        throw new Error('expected the caller signal to reach the provider');
      },
    };
    const runner = Sequence.create()
      .step('first', Agent.create({ provider, model: 'm' }).build())
      .build();
    const observed = await observe(runner, undefined, cancellation.signal);
    expect(observed.run).toEqual({ status: 'rejected', reason: cancellation.signal.reason });
    const { fatal, failure } = expectFatal(observed);
    expect(failure.structuredError.message).toBe('This operation was aborted');
    expect(fatal.payload.error).toBe('The run failed: This operation was aborted');
  });

  it.each([
    ['Failed to fetch', LLM_ERROR_SENTENCES.unreachable],
    ['invalid API key', LLM_ERROR_SENTENCES.auth],
    ['rate limit exceeded', LLM_ERROR_SENTENCES.rateLimited],
    ['request timed out', LLM_ERROR_SENTENCES.timeout],
  ])('keeps provider wording for %s', async (message, wording) => {
    const { fatal } = expectFatal(await observe(failsFirst(message)));
    expect(fatal.payload.error).toBe(wording);
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

  it.each(['first', 'later'] as const)(
    'redaction on the %s member covers paired provider failures',
    async (redactedMember) => {
      const secrets = ['private-detail-alpha', 'private-detail-omega'];
      const observations = [];
      for (const secret of secrets) {
        const observed = await observe(failsFirst(`provider down for ${secret}`, redactedMember));
        expect(observed.run).toMatchObject({
          status: 'rejected',
          reason: { message: expect.stringContaining(secret) },
        });
        const { fatal, failure } = expectFatal(observed);
        expect(failure.structuredError.message).toBe('[REDACTED]');
        expect(fatal.payload).toEqual({ error: '[REDACTED]', stage: '[REDACTED]', scope: 'run' });
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
    },
  );

  it('reuses a Sequence after a failed run without a stale fatal', async () => {
    let failing = true;
    const provider: LLMProvider = {
      name: 'recovering-provider',
      async complete(request) {
        if (failing) throw new Error('first run failed');
        return mock({ reply: 'Recovered.' }).complete(request);
      },
    };
    const runner = Sequence.create()
      .step('first', Agent.create({ provider, model: 'm' }).build())
      .build();
    const failures: AgentfootprintEvent[] = [];
    const off = runner.on(FATAL, (event) => failures.push(event));
    try {
      await expect(runner.run({ message: 'First.' })).rejects.toThrow('first run failed');
      expect(failures).toHaveLength(1);
      failing = false;
      const observed = await observe(runner);
      expect(observed.run).toEqual({ status: 'fulfilled', value: 'Recovered.' });
      expect([observed.full.closed, observed.text.closed]).toEqual([true, true]);
      expect(failures).toHaveLength(1);
    } finally {
      off();
      await runner.shutdown();
    }
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
        const { fatal } = expectFatal(observed);
        expect(fatal.payload.error).toBe('The AI call failed: provider down');
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

  it('preserves the standalone LLMCall fallback', async () => {
    const runner = LLMCall.create({ provider: down('provider down'), model: 'm' }).build();
    const { fatal } = expectFatal(await observe(runner));
    expect(fatal.payload.error).toBe('The AI call failed: provider down');
  });
});
