import { describe, expect, it } from 'vitest';
import { Agent, defineTool, isInputPause, requestInput } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import { recordAnswerAccount } from '../../src/recorders/observability/answerAccount/recorder.js';

const runWith = (observerDelivery: 'inline' | 'deferred' = 'inline') =>
  Agent.create({
    provider: new MockProvider({ reply: 'I found the answer.' }),
    model: 'mock',
    observerDelivery,
  })
    .system('Be brief.')
    .build();

describe('internal explanation recorder', () => {
  it.each(['inline', 'deferred'] as const)(
    'matches a settled tool-free answer in %s mode',
    async (delivery) => {
      const runner = runWith(delivery);
      const observed = recordAnswerAccount(runner, 128 * 1024);
      await runner.run({ message: 'What did you find?' });
      expect(observed.toSnapshot()).toBeUndefined();
      observed.recording.stop();
      const recording = observed.recording.toRecording();
      expect(runner.getLastSnapshot()?.observerStats?.drops ?? 0).toBe(0);
      const bundle = observed.toSnapshot()!;
      expect(bundle.gaps).toEqual([]);
      expect(bundle.events.map(({ index, event }) => [index, event.type])).toEqual(
        recording.events.map((event, index) => [index, event.type]),
      );
      const view = bundleView(bundle)!;
      expect(view).toBeDefined();
      const fromBundle = buildAccountFromView(view, validateDeclarations(undefined));
      expect(JSON.stringify(fromBundle)).toBe(JSON.stringify(accountForAnswer(recording)));
      expect(JSON.stringify(recording.snapshot)).not.toContain(
        'agentfootprint:answer-account-observation',
      );
    },
  );

  it('withholds a bundle when deferred delivery loses events but the model start and terminal survive', async () => {
    const runner = Agent.create({
      provider: new MockProvider({ reply: 'I found the answer.' }),
      model: 'mock',
      observerDelivery: 'deferred',
      observerDeliveryOptions: { maxQueue: 1, overflow: 'drop-oldest' },
    })
      .system('Be brief.')
      .build();
    const observed = recordAnswerAccount(runner, 128 * 1024);
    await runner.run('What was found?');
    observed.recording.stop();

    expect(runner.getLastSnapshot()?.observerStats?.drops).toBeGreaterThan(0);
    expect(observed.recording.droppedEvents).toBe(0);
    const events = observed.recording.toRecording().events;
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['agentfootprint.stream.llm_start', 'agentfootprint.agent.turn_end']),
    );
    const bundle = observed.toSnapshot()!;
    expect(bundle.events.map(({ index, event }) => [index, event.type])).toEqual(
      events.map((event, index) => [index, event.type]),
    );
    expect(bundleView(bundle)).toBeUndefined();
    expect(bundle.gaps).toContain('observer-loss');
    expect(bundle.state).toBeUndefined();
  });

  it('withholds a bundle with the terminal event but no admitted model-start evidence', async () => {
    const runner = runWith();
    const observed = recordAnswerAccount(
      runner,
      128 * 1024,
      {},
      (event) => event.type !== 'agentfootprint.stream.llm_start',
    );
    await runner.run('What was found?');
    observed.recording.stop();

    expect(runner.getLastSnapshot()?.observerStats?.drops ?? 0).toBe(0);
    expect(observed.recording.droppedEvents).toBe(0);
    const types = observed.recording.toRecording().events.map((event) => event.type);
    expect(types).toContain('agentfootprint.agent.turn_end');
    expect(types).not.toContain('agentfootprint.stream.llm_start');
    const bundle = observed.toSnapshot()!;
    expect(bundleView(bundle)).toBeUndefined();
    expect(bundle.gaps).toContain('missing-answer-evidence');
    expect(bundle.state).toBeUndefined();
  });

  it('keeps summarized deferred emits unavailable', async () => {
    const runner = Agent.create({
      provider: new MockProvider({ reply: 'I found the answer.' }),
      model: 'mock',
      observerDelivery: 'deferred',
      observerDeliveryOptions: { capture: 'summary' },
    })
      .system('Be brief.')
      .build();
    const observed = recordAnswerAccount(runner, 128 * 1024);
    await runner.run('What was found?');
    observed.recording.stop();

    expect(runner.getLastSnapshot()?.observerStats?.summarizedEmits).toBeGreaterThan(0);
    const bundle = observed.toSnapshot()!;
    expect(bundle.gaps).toContain('observer-loss');
    expect(bundleView(bundle)).toBeUndefined();
    expect(bundle.state).toBeUndefined();
  });

  it('does not serve an evicted tail with reset coordinates as a whole account', async () => {
    const runner = runWith();
    const observed = recordAnswerAccount(runner, 128 * 1024, { maxEvents: 5 });
    await runner.run({ message: 'What did you find?' });
    observed.recording.stop();
    const bundle = observed.toSnapshot()!;
    expect(bundle.gaps).toContain('retained-events-dropped');
    expect(bundle.firstRetainedIndex).toBeGreaterThan(0);
    expect(bundle.events.map(({ index, event }) => [index, event.type])).toEqual(
      observed.recording.toRecording().events.map((event, index) => [index, event.type]),
    );
    expect(bundleView(bundle)).toBeUndefined();
  });

  it('does not combine successive runs into one explanation', async () => {
    const runner = runWith();
    const observed = recordAnswerAccount(runner, 128 * 1024);
    await runner.run({ message: 'First question' });
    await runner.run({ message: 'Second question' });
    observed.recording.stop();
    expect(observed.toSnapshot()).toMatchObject({ gaps: ['multiple-runs'], events: [] });
  });

  it('shares timeline admission with a filter and keeps actual recording positions', async () => {
    const runner = runWith();
    const observed = recordAnswerAccount(
      runner,
      128 * 1024,
      {},
      (event) => event.type !== 'agentfootprint.context.injected',
    );
    await runner.run('What did you find?');
    observed.recording.stop();
    const events = observed.recording.toRecording().events;
    expect(events.some((event) => event.type === 'agentfootprint.context.injected')).toBe(false);
    expect(observed.toSnapshot()!.events.map(({ index, event }) => [index, event.type])).toEqual(
      events.map((event, index) => [index, event.type]),
    );
  });

  it('keeps a direct resume event at its recording position without serving an incomplete account', async () => {
    const runner = Agent.create({
      provider: mock({
        replies: [
          { toolCalls: [{ id: 'year', name: 'ask_year', args: {} }] },
          { content: 'The year was recorded.' },
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'ask_year',
          description: 'Ask for the year.',
          inputSchema: { type: 'object' },
          execute: () =>
            requestInput({
              id: 'year',
              question: 'Which year?',
              fields: [{ id: 'year', type: 'number', required: true }],
            }),
        }),
      )
      .build();
    const paused = await runner.run('Use the year I give you.');
    if (!isInputPause(paused)) throw new Error('Expected an input pause');
    const observed = recordAnswerAccount(runner, 128 * 1024);
    await runner.resume(paused.checkpoint, {
      requestId: paused.awaitingInput.requestId,
      values: { year: 2026 },
    });
    observed.recording.stop();
    const events = observed.recording.toRecording().events;
    const resumeAt = events.findIndex((event) => event.type === 'agentfootprint.pause.resume');
    expect(resumeAt).toBeGreaterThanOrEqual(0);
    const bundle = observed.toSnapshot()!;
    expect(bundle.gaps).toContain('resumed-state');
    expect(bundle.events[resumeAt]).toMatchObject({
      index: resumeAt,
      event: { type: 'agentfootprint.pause.resume' },
    });
    expect(bundleView(bundle)).toBeUndefined();
  });

  it.each(['inline', 'deferred'] as const)(
    'seals a constant policy marker with %s delivery even when capture loses evidence',
    async (observerDelivery) => {
      async function coveredBundle(message: string) {
        const runner = Agent.create({
          provider: mock({ reply: 'Fixed reply.' }),
          model: 'mock',
          observerDelivery,
          ...(observerDelivery === 'deferred' && {
            observerDeliveryOptions: { maxQueue: 1, overflow: 'drop-oldest' as const },
          }),
          redact: { keys: ['userMessage'] },
        }).build();
        const observed = recordAnswerAccount(runner, 8 * 1024);
        await runner.run(message);
        observed.recording.stop();
        const bundle = observed.toSnapshot()!;
        expect(bundle.gaps).toEqual(['redaction']);
        expect(observed.peakRetainedEventBytes).toBe(0);
        return JSON.stringify(bundle);
      }

      expect(await coveredBundle('Short prompt.')).toBe(await coveredBundle('x'.repeat(12_000)));
    },
  );

  it('keeps a late attachment unavailable', async () => {
    const runner = runWith();
    await runner.run('I already ran.');
    const observed = recordAnswerAccount(runner, 128 * 1024);
    observed.recording.stop();
    expect(observed.toSnapshot()).toMatchObject({
      gaps: ['no-start', 'no-terminal-commit'],
      events: [],
    });
  });

  it.each([19, 38])(
    'bounds raw event evidence for %i synthetic calls without retaining result rows',
    async (count) => {
      const provider = mock({
        replies: [
          ...Array.from({ length: count }, (_, i) => ({
            toolCalls: [{ id: `call-${i}`, name: 'list_rows', args: {} }],
          })),
          { content: 'I found rows in each batch.' },
        ],
      });
      const rows = Array.from({ length: 200 }, (_, row) => ({
        row,
        detail: 'RESULT-BODY-SENTINEL',
      }));
      const runner = Agent.create({ provider, model: 'mock', maxIterations: count + 1 })
        .tool(
          defineTool({
            name: 'list_rows',
            description: 'List fixture rows.',
            inputSchema: { type: 'object' },
            execute: () => rows,
          }),
        )
        .build();
      const observed = recordAnswerAccount(runner, 2 * 1024 * 1024);
      await runner.run('List all batches.');
      observed.recording.stop();
      const bundle = observed.toSnapshot()!;
      const raw = JSON.stringify(bundle);
      const calls = observed.recording
        .toRecording()
        .events.filter((event) => event.type === 'agentfootprint.stream.tool_end');
      expect(calls).toHaveLength(count);
      expect(bundle.gaps).toContain('tool-results');
      expect(raw).not.toContain('RESULT-BODY-SENTINEL');
      expect(bundleView(bundle)).toBeUndefined();
      expect(Buffer.byteLength(raw)).toBeLessThan(2 * 1024 * 1024);
      if (process.env.EXPL1_MEASURE === '1') {
        process.stdout.write(
          JSON.stringify({
            calls: count,
            rowsPerCall: rows.length,
            rawBundleBytes: Buffer.byteLength(raw),
            peakRetainedEventBytes: observed.peakRetainedEventBytes,
            gaps: bundle.gaps,
          }) + '\n',
        );
      }
    },
  );
});
