/**
 * The re-ask of a typed ask is never silent.
 *
 * The field loop this pins shut: a tool asks for a time window, the person
 * answers, the app validates the answer and REFUSES it (telling only the
 * model why), the tool asks again — and the person sees the identical
 * question with no word about their answer. Two halves:
 *
 *   - `refused` — the app declares the refused answer and its OWN reason on
 *     the re-ask, and it rides the awaiting-input shape the person receives.
 *   - `repeat`  — with no declaration, the runtime still marks the re-ask of
 *     the same `id` (count + the previous answer as the record holds it).
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  InputRequestError,
  defineTool,
  isInputPause,
  requestInput,
  type InputRequestDeclaration,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { allow } from '../../../src/core/agent/middleware/outcomes.js';
import type { LLMResponse } from '../../../src/adapters/types.js';

const collectCall = (id: string) => ({ toolCalls: [{ id, name: 'collect_window', args: {} }] });

const WINDOW = {
  id: 'query-window',
  question: 'Complete the query time window: year and timezone.',
  fields: [
    { id: 'year', type: 'number', required: true },
    { id: 'timezone', type: 'string', required: true },
  ],
} as const satisfies InputRequestDeclaration;

interface Options {
  readonly replies: readonly Partial<LLMResponse>[];
  /** The app's own validation: refuse the answer, and say why, to the model only. */
  readonly refuseIf?: (values: Record<string, unknown>) => string | undefined;
  /** Re-raise with a declared refusal (the fix an app adopts). */
  readonly declareRefusal?: boolean;
  /** A result-redaction rule, as the answer already meets it. */
  readonly redact?: string;
  readonly onPauseEvent?: (payload: unknown) => void;
}

function windowAgent(options: Options) {
  let refusal: InputRequestDeclaration['refused'];
  const runner = Agent.create({
    provider: mock({ replies: options.replies as LLMResponse[] }),
    model: 'mock',
  })
    .tool(
      defineTool({
        name: 'collect_window',
        description: 'Collect the query time window.',
        inputSchema: { type: 'object', properties: {} },
        execute: () =>
          requestInput({
            ...WINDOW,
            ...(options.declareRefusal && refusal !== undefined && { refused: refusal }),
          }),
      }),
    )
    .act({
      afterTool: [
        {
          name: 'validate-window',
          onToolResult: (call) => {
            let result = call.result as {
              status?: string;
              values?: Record<string, unknown>;
            };
            if (options.redact !== undefined)
              result = JSON.parse(
                JSON.stringify(result).replaceAll(options.redact, '[redacted]'),
              ) as typeof result;
            if (result?.status !== 'input_received') return allow();
            const reason = options.refuseIf?.(result.values ?? {});
            if (reason === undefined) return allow(result, 'answer accepted');
            refusal = { answer: result.values as Record<string, number | string>, reason };
            return allow(
              { status: 'query_window_invalid', reason, next: 'Call collect_window again.' },
              'answer refused by the app',
            );
          },
        },
      ],
    })
    .build();
  if (options.onPauseEvent)
    runner.on('agentfootprint.pause.request', (e) => options.onPauseEvent!(e.payload));
  return runner;
}

const tooEarly = (values: Record<string, unknown>) =>
  typeof values.year === 'number' && values.year < 2020
    ? `The year ${values.year} is before the retained data (2020 onwards).`
    : undefined;

async function paused(result: unknown) {
  if (!isInputPause(result)) throw new Error('expected an input pause');
  return result;
}
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('a refused answer is carried to the person (refused)', () => {
  it('rides the awaiting-input shape, the checkpoint and the pause.request event', async () => {
    const events: unknown[] = [];
    const runner = windowAgent({
      replies: [collectCall('c1'), collectCall('c2'), { content: 'Done.' }],
      refuseIf: tooEarly,
      declareRefusal: true,
      onPauseEvent: (p) => events.push(p),
    });
    const first = await paused(await runner.run({ message: 'Traffic on 11 September.' }));
    expect(first.awaitingInput.refused).toBeUndefined();
    const second = await paused(
      await runner.resume(roundTrip(first.checkpoint), {
        requestId: first.awaitingInput.requestId,
        values: { year: 2019, timezone: 'UTC' },
      }),
    );
    const refused = {
      answer: { year: 2019, timezone: 'UTC' },
      reason: 'The year 2019 is before the retained data (2020 onwards).',
    };
    expect(second.awaitingInput.refused).toEqual(refused);
    expect(second.awaitingInput.question).toBe(WINDOW.question);
    // The durable pause carries it, and the event the host renders from.
    expect(
      (roundTrip(second.checkpoint).pauseData as { awaitingInput: { refused: unknown } })
        .awaitingInput.refused,
    ).toEqual(refused);
    expect(
      (events[1] as { questionPayload: { awaitingInput: { refused: unknown } } }).questionPayload
        .awaitingInput.refused,
    ).toEqual(refused);
    // The re-ask is also marked a repeat: a fact beside the app's reason.
    expect(second.awaitingInput.repeat?.count).toBe(1);
  });

  it('refuses a malformed refusal at the raise — the library never invents a reason', () => {
    for (const refused of [
      { reason: '   ' },
      { answer: { year: 2019 } },
      { reason: 'no', answer: { month: 3 } },
      { reason: 'no', extra: true },
    ]) {
      expect(() => requestInput({ ...WINDOW, refused } as never)).toThrow(InputRequestError);
    }
  });
});

describe('a re-ask without a declaration is marked (repeat)', () => {
  it('counts the re-ask and carries the previous answer, across checkpoints and fresh agents', async () => {
    const replies = [collectCall('c1'), collectCall('c2'), collectCall('c3'), { content: 'Done.' }];
    const first = await paused(
      await windowAgent({ replies }).run({ message: 'Traffic on 11 September.' }),
    );
    // Each leg resumes on a FRESH agent from a JSON copy: the count crosses
    // the checkpoint on the awaiting-input shape itself.
    const second = await paused(
      await windowAgent({ replies: replies.slice(1) }).resume(roundTrip(first.checkpoint), {
        requestId: first.awaitingInput.requestId,
        values: { year: 2019, timezone: 'UTC' },
      }),
    );
    expect(second.awaitingInput.repeat).toEqual({
      count: 1,
      previousAnswer: { year: 2019, timezone: 'UTC' },
    });
    expect(second.awaitingInput.refused).toBeUndefined();
    const third = await paused(
      await windowAgent({ replies: replies.slice(2) }).resume(roundTrip(second.checkpoint), {
        requestId: second.awaitingInput.requestId,
        values: { year: 2018, timezone: 'Europe/Paris' },
      }),
    );
    expect(third.awaitingInput.repeat).toEqual({
      count: 2,
      previousAnswer: { year: 2018, timezone: 'Europe/Paris' },
    });
  });

  it('keeps only the count when the record no longer holds the answer (a rule replaced it)', async () => {
    const runner = windowAgent({
      replies: [collectCall('c1'), collectCall('c2'), { content: 'Done.' }],
      refuseIf: tooEarly,
    });
    const first = await paused(await runner.run({ message: 'Traffic on 11 September.' }));
    const second = await paused(
      await runner.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { year: 2019, timezone: 'UTC' },
      }),
    );
    expect(second.awaitingInput.repeat).toEqual({ count: 1 });
  });

  it('carries the previous answer redacted exactly as the record holds it', async () => {
    const runner = windowAgent({
      replies: [collectCall('c1'), collectCall('c2'), { content: 'Done.' }],
      redact: 'PRIVATE-ZONE',
    });
    const first = await paused(await runner.run({ message: 'Traffic on 11 September.' }));
    const second = await paused(
      await runner.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { year: 2024, timezone: 'PRIVATE-ZONE' },
      }),
    );
    expect(second.awaitingInput.repeat).toEqual({
      count: 1,
      previousAnswer: { year: 2024, timezone: '[redacted]' },
    });
    expect(JSON.stringify(second.checkpoint.pauseData)).not.toContain('PRIVATE-ZONE');
  });

  it('keeps only what the PERSON gave, never a value the tool supplied', async () => {
    const runner = Agent.create({
      provider: mock({ replies: [collectCall('c1'), collectCall('c2'), { content: 'Done.' }] }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'collect_window',
          description: 'Collect the query time window.',
          inputSchema: { type: 'object', properties: {} },
          execute: () => requestInput({ ...WINDOW, supplied: { timezone: 'UTC' } }),
        }),
      )
      .build();
    const first = await paused(await runner.run({ message: 'Traffic on 11 September.' }));
    const second = await paused(
      await runner.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { year: 2019 },
      }),
    );
    expect(second.awaitingInput.repeat).toEqual({ count: 1, previousAnswer: { year: 2019 } });
  });

  it('does not mark a new turn, nor an ask with another id', async () => {
    const runner = windowAgent({
      replies: [collectCall('c1'), { content: 'Done.' }, collectCall('c2'), { content: 'Done.' }],
    });
    const first = await paused(await runner.run({ message: 'Traffic on 11 September.' }));
    expect(
      await runner.resume(first.checkpoint, {
        requestId: first.awaitingInput.requestId,
        values: { year: 2024, timezone: 'UTC' },
      }),
    ).toBe('Done.');
    const next = await paused(await runner.run({ message: 'Traffic on 12 September.' }));
    expect(next.awaitingInput.repeat).toBeUndefined();
  });
});

describe('the first ask is unchanged', () => {
  it('stamps exactly the keys it stamped before', async () => {
    const first = await paused(
      await windowAgent({ replies: [collectCall('c1')] }).run({
        message: 'Traffic on 11 September.',
      }),
    );
    expect(Object.keys(first.awaitingInput)).toEqual([
      'id',
      'question',
      'fields',
      'status',
      'requestId',
      'supplied',
      'origins',
      'missing',
      'origin',
    ]);
    expect(roundTrip(first.awaitingInput)).toEqual({
      id: 'query-window',
      question: WINDOW.question,
      fields: WINDOW.fields,
      status: 'awaiting_input',
      requestId: first.awaitingInput.requestId,
      supplied: {},
      origins: {},
      missing: ['year', 'timezone'],
      origin: { originalRequest: 'Traffic on 11 September.', toolCallId: 'c1' },
    });
  });
});
