import { expect, it } from 'vitest';
import type { InnerCallRan } from '../../src/provider-contract/innerCalls.js';
import type { LLMMessage, ToolCallEntry } from '../../src/provider-contract/types.js';
import { extractSequence } from '../../src/security/extractSequence.js';
import { seeded } from '../helpers/seededText.js';

type Outcome = 'ran' | 'denied' | 'settled' | 'pending';

function generatedHistory(seed: number) {
  const next = seeded(seed);
  const draw = (bound: number) => Math.floor(next() * bound);
  const completed = (): Outcome => (draw(3) === 0 ? 'denied' : 'ran');
  const paletteTools = ['find_swatch', 'read_palette', 'describe_colour'] as const;

  function batch(iteration: number, outcomes: readonly Outcome[], pauseAt?: number) {
    const calls = outcomes.map((_, i) => {
      const id = `batch-${iteration}-call-${i + 1}`;
      return {
        id,
        name: paletteTools[draw(paletteTools.length)]!,
        args: { swatch: id, tones: [draw(12), draw(12)] },
      };
    });
    const paused = pauseAt === undefined ? undefined : calls[pauseAt];
    const proposal: LLMMessage = { role: 'assistant', content: '', toolCalls: calls };
    const answers: LLMMessage[] = [];
    const entries: ToolCallEntry[][] = calls.map(() => []);
    for (const [i, call] of calls.entries()) {
      const result = { role: 'tool' as const, toolName: call.name, toolCallId: call.id };
      switch (outcomes[i]) {
        case 'pending':
          break;
        case 'denied':
          answers.push({ ...result, content: '[permission denied: fixture refusal]' });
          break;
        case 'settled':
          if (!paused) throw new Error('Settlement requires a paused call in the same batch');
          answers.push({
            ...result,
            content: `Tool '${call.name}' was not executed on that call: the run paused on call '${paused.id}' to '${paused.name}', earlier in the same batch, and resumed without executing the calls that followed it in that batch.`,
            notDispatched: { pausedCall: { toolCallId: paused.id, toolName: paused.name } },
          });
          break;
        case 'ran': {
          // Always put nested calls on the paused call's answer, with varied counts elsewhere.
          const nested: InnerCallRan[] = Array.from(
            { length: i === pauseAt ? 2 : draw(3) },
            (_, index) => ({
              toolCallId: `${call.id}#inner-${index + 1}`,
              toolName: 'read_tone',
              args: { swatch: call.id, tone: index, value: draw(12) },
            }),
          );
          answers.push({
            ...result,
            content: 'palette data',
            ...(nested.length > 0 && { calls: nested }),
          });
          // The oracle takes this directly from the planned outcomes.
          entries[i] = [
            { name: call.name, args: call.args, iteration },
            ...nested.map(
              ({ toolName, args }): ToolCallEntry => ({
                name: toolName,
                args,
                iteration,
                inner: true,
              }),
            ),
          ];
          break;
        }
      }
    }
    return { proposal, answers, entries };
  }

  const first = batch(1, ['ran', 'denied', ...Array.from({ length: draw(3) }, completed)]);
  const pauseAt = draw(4);
  const paused = batch(
    2,
    [
      ...Array.from({ length: pauseAt }, completed),
      'ran',
      ...Array.from({ length: 1 + draw(3) }, (): Outcome => 'settled'),
    ],
    pauseAt,
  );
  const checkpointHistory: LLMMessage[] = [
    { role: 'user', content: 'Show me the palette.' },
    first.proposal,
    ...first.answers,
    { role: 'assistant', content: 'I have the first palette.', toolCalls: [] },
    { role: 'user', content: 'Show me another one.' },
    paused.proposal,
    ...paused.answers.slice(0, pauseAt),
  ];
  const restored = JSON.parse(JSON.stringify(checkpointHistory)) as LLMMessage[];
  const continuation = Array.from({ length: 1 + draw(3) }, (_, i) =>
    batch(i + 3, Array.from({ length: 1 + draw(4) }, completed)),
  );
  const lastBatch = 3 + continuation.length;
  const inFlight = batch(lastBatch, [...Array.from({ length: draw(3) }, completed), 'pending']);
  const resumed = [
    ...restored,
    ...paused.answers.slice(pauseAt),
    ...continuation.flatMap(({ proposal, answers }) => [proposal, ...answers]),
    inFlight.proposal,
    ...inFlight.answers,
  ];

  const pausedExpected = [...first.entries.flat(), ...paused.entries.slice(0, pauseAt).flat()];
  const resumedExpected = [
    ...first.entries.flat(),
    ...paused.entries.flat(),
    ...continuation.flatMap(({ entries }) => entries.flat()),
    ...inFlight.entries.flat(),
  ];
  const iteration = lastBatch + draw(3);
  // The legacy output uses the current iteration for the last contributing batch
  // when it is ahead of the number of recorded batches.
  const lastContributing = resumedExpected.at(-1)?.iteration;
  const expected = resumedExpected.map((entry) =>
    iteration > lastBatch && entry.iteration === lastContributing ? { ...entry, iteration } : entry,
  );
  return { restored, pausedExpected, resumed, expected, iteration };
}

it('preserves main’s sequence for generated histories with unique call IDs', () => {
  for (let seed = 1; seed <= 400; seed++) {
    const { restored, pausedExpected, resumed, expected, iteration } = generatedHistory(seed);
    const ids = resumed.flatMap(({ toolCalls }) => (toolCalls ?? []).map(({ id }) => id));
    expect(new Set(ids).size, `unique proposals for seed ${seed}`).toBe(ids.length);
    expect(extractSequence(restored, 2), `paused history for seed ${seed}`).toStrictEqual(
      pausedExpected,
    );
    expect(extractSequence(resumed, iteration), `resumed history for seed ${seed}`).toStrictEqual(
      expected,
    );
  }
});
