import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { Agent } from '../../../src/index.js';
import { withRetry, ReliabilityFailFastError } from '../../../src/doors/resilience.js';
import { readWithHeartbeat } from '../../helpers/hostingStreams.js';
import { answer, chunk, failure, scriptedProvider, terminal, traceCall } from './fixture.js';

const modes = ['classic', 'dynamic', 'dynamic-grouped'] as const;
const deliveries = ['inline', 'deferred'] as const;
const profiles = modes.flatMap((reactMode) =>
  deliveries.map((observerDelivery) => ({ reactMode, observerDelivery })),
);

describe.each(profiles)('call trace ($reactMode, $observerDelivery)', (profile) => {
  it('switches the complete call after policy approval and serves only the selected answer', async () => {
    const trace = traceCall();
    const primary = scriptedProvider('primary', trace, [failure('service unavailable')]);
    const secondary = scriptedProvider('secondary', trace, [answer('secondary answer')]);
    const agent = Agent.create({
      ...profile,
      provider: primary,
      model: 'model-primary',
      temperature: 0.2,
      maxTokens: 80,
    })
      .system('Read this fixture.')
      .reliability({
        providers: [
          { provider: primary, name: 'primary', model: 'model-primary' },
          { provider: secondary, name: 'secondary', model: 'model-secondary' },
        ],
        postDecide: [
          {
            when(scope) {
              trace.mark('policy:retry-other');
              return scope.error !== undefined && scope.canSwitchProvider;
            },
            then: 'retry-other',
            kind: 'fixture-switch',
            feedbackForLLM: 'Try the other provider.',
          },
        ],
      })
      .build();
    const events: string[] = [];
    const offRetry = agent.on('agentfootprint.reliability.retried', (event) => {
      const { action, fromProvider, toProvider } = event.payload;
      events.push(`${action}:${fromProvider}:${toProvider}`);
    });
    const offRecovery = agent.on('agentfootprint.reliability.recovered', (event) => {
      events.push(`recovered:${event.payload.recoveredVia}`);
    });
    const offTurn = agent.on('agentfootprint.agent.turn_end', (event) => {
      events.push(`turn:${event.payload.finalContent}`);
    });
    try {
      expect(await agent.run({ message: 'What happened?' })).toBe('secondary answer');
      await agent.drainObservers();
      expect(trace.requests.map(({ provider, operation }) => [provider, operation])).toEqual([
        ['primary', 'complete'],
        ['secondary', 'complete'],
      ]);
      expect(trace.steps.map(({ action }) => action)).toEqual([
        'primary.complete',
        'policy:retry-other',
        'secondary.complete',
        'policy:retry-other',
      ]);
      const [initial, retried] = trace.requests.map(({ bytes }) => JSON.parse(bytes));
      expect(initial).toMatchObject({ model: 'model-primary', temperature: 0.2, maxTokens: 80 });
      expect(retried).toMatchObject({ model: 'model-secondary', temperature: 0.2, maxTokens: 80 });
      expect(initial.messages).not.toContainEqual(
        expect.objectContaining({ content: 'Try the other provider.' }),
      );
      expect(retried.messages).toContainEqual(
        expect.objectContaining({ content: 'Try the other provider.' }),
      );
      expect(events).toEqual([
        'retry-other:primary:secondary',
        'recovered:retry-other',
        'turn:secondary answer',
      ]);
    } finally {
      offRetry();
      offRecovery();
      offTurn();
      await agent.shutdown();
    }
  });

  it('emits recovery before the visible stream token and closes text on the owning turn', async () => {
    const trace = traceCall();
    const primary = scriptedProvider(
      'primary',
      trace,
      [],
      [
        [failure('before the first step')],
        [
          chunk(''),
          chunk('Visible', 1),
          chunk(' answer.', 2),
          terminal(answer('Visible answer.'), 3),
        ],
      ],
    );
    const agent = Agent.create({
      ...profile,
      provider: withRetry(primary, { initialDelayMs: 0, maxAttempts: 2 }),
      model: 'fixture-model',
    }).build();
    const events: string[] = [];
    const offRetry = agent.on('agentfootprint.error.retried', () => events.push('retry'));
    const offRecovery = agent.on('agentfootprint.error.recovered', () => events.push('recovered'));
    const offToken = agent.on('agentfootprint.stream.token', (event) =>
      events.push(event.payload.content),
    );
    const offTurn = agent.on('agentfootprint.agent.turn_end', () => events.push('turn ended'));
    const text = readWithHeartbeat(agent, { format: 'text' });
    const expectedTypes = [
      'agentfootprint.error.retried',
      'agentfootprint.error.recovered',
      'agentfootprint.stream.token',
      'agentfootprint.stream.token',
      'agentfootprint.agent.turn_end',
    ];
    const full = readWithHeartbeat(agent, {
      filter: (event) => expectedTypes.includes(event.type),
    });
    try {
      expect(await agent.run({ message: 'What happened?' })).toBe('Visible answer.');
      await agent.drainObservers();
      expect(await text()).toEqual({ closed: true, chunks: ['Visible', ' answer.'] });
      const { closed, chunks: frames } = await full();
      expect(closed).toBe(true);
      expect(frames.map((frame) => frame.split('\n')[0])).toEqual(
        expectedTypes.map((type) => `event: ${type}`),
      );
      const end = JSON.parse(frames.at(-1)!.split('\n')[1]!.slice('data: '.length));
      expect(end).toMatchObject({
        meta: { rootTurn: true },
        payload: { finalContent: 'Visible answer.' },
      });
      expect(trace.steps.map(({ action }) => action)).toEqual([
        'primary.stream',
        'primary.close',
        'primary.stream',
        'primary.close',
      ]);
      expect(events).toEqual(['retry', 'recovered', 'Visible', ' answer.', 'turn ended']);
    } finally {
      offRetry();
      offRecovery();
      offToken();
      offTurn();
      await Promise.all([text(), full()]);
      await agent.shutdown();
    }
  });
});

it('does not enter either provider method when the reliability pre-check refuses', async () => {
  const trace = traceCall();
  const agent = Agent.create({
    provider: scriptedProvider('primary', trace, [answer('never sent')]),
    model: 'fixture-model',
  })
    .reliability({
      preCheck: [
        {
          when() {
            trace.mark('pre-check');
            return true;
          },
          then: 'fail-fast',
          kind: 'fixture-refusal',
        },
      ],
    })
    .build();
  try {
    await expect(agent.run({ message: 'What happened?' })).rejects.toBeInstanceOf(
      ReliabilityFailFastError,
    );
    expect(trace.steps.map(({ action }) => action)).toEqual(['pre-check']);
    expect(trace.requests).toEqual([]);
  } finally {
    await agent.shutdown();
  }
});

it('records separate stream and complete entries when the terminal response is missing', async () => {
  const trace = traceCall();
  const agent = Agent.create({
    provider: scriptedProvider(
      'primary',
      trace,
      [answer('completed by second call')],
      [[{ content: '', tokenIndex: 0, done: true }]],
    ),
    model: 'fixture-model',
  }).build();
  try {
    expect(await agent.run({ message: 'What happened?' })).toBe('completed by second call');
    expect(trace.steps.map(({ action }) => action)).toEqual([
      'primary.stream',
      'primary.close',
      'primary.complete',
    ]);
    expect(trace.requests[0]?.bytes).toBe(trace.requests[1]?.bytes);
  } finally {
    await agent.shutdown();
  }
});

it('does not start the policy retry after the caller cancels', async () => {
  const controller = new AbortController();
  const reason = new Error('caller cancelled');
  const trace = traceCall();
  const primary = {
    ...scriptedProvider('primary', trace, [answer('{"ok":false}')]),
    carriesNativeOutputSchema: true,
    supportsNativeOutputSchema() {
      if (controller.signal.aborted) trace.mark('retry:prepare');
      return true;
    },
  };
  const agent = Agent.create({ provider: primary, model: 'fixture-model' })
    .outputSchema(
      { parse: (value: unknown) => value },
      {
        strategy: 'native',
        jsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
        },
      },
    )
    .reliability({
      postDecide: [
        {
          when: (scope) => scope.response?.content === '{"ok":false}',
          then: 'retry',
          kind: 'fixture-refusal',
          feedbackForLLM() {
            trace.mark('policy:retry');
            controller.abort(reason);
            return 'Try another answer.';
          },
        },
      ],
    })
    .build();
  try {
    await expect(
      agent.run({ message: 'What happened?' }, { env: { signal: controller.signal } }),
    ).rejects.toBe(reason);
    // The outer run can reject before the cancelled stage finishes unwinding.
    await setImmediate();
    expect(trace.steps.map(({ action }) => action)).toEqual(['primary.complete', 'policy:retry']);
  } finally {
    await agent.shutdown();
  }
});
