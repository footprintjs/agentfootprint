/**
 * 84 — a tool's period forms: the library writes the person's window into the
 * tool's own arguments, exactly, and hands the tool the window it asks for.
 *
 * Real tools spell a period in many shapes — two epoch-millisecond arguments,
 * a joined ISO range, a date, a look-back. The tool declares them as FACTS:
 *
 *   period: {
 *     forms: [{ kind: 'bounds',
 *               from: { argument: 'start_time', as: 'epoch-ms' },
 *               to:   { argument: 'end_time',   as: 'epoch-ms', edge: 'exclusive' } }],
 *     direction: 'past', retention: '30d',
 *   }
 *
 *   - under `.time()`, when the model leaves the period out and the turn has
 *     exactly ONE window of the person's (one they confirmed or wrote in the
 *     time ask — a reading of their words only PROPOSES, the owner's decision
 *     "Always confirm" — or a `time.window` set in a UI), the library fills it
 *     — converted into the first form that holds it exactly — and files the
 *     arguments as the person's (`answered`, `matched: 'mention'`) with one
 *     `call-window` row;
 *   - a window the model sent is never written over: equal to the person's, it
 *     is bound (by the quote the model declared, or by value); different, it
 *     runs as sent and is recorded `model-chosen` beside the person's — the
 *     answer's standing then reads "not sure";
 *   - the tool gets `ctx.time = { asked, zone, now, dispatchedAt }` (over MCP,
 *     in the call's `_meta.agentfootprint.time`), and the same declaration
 *     travels in a listing's `_meta.agentfootprint.period`.
 *
 * Run:  npm run example examples/features/84-tool-period-forms.ts
 */

import { Agent, defineTool, isInputPause, type TimeReader } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/84-tool-period-forms',
  title: "A tool's period forms — the person's window, written into the tool's own arguments",
  group: 'features',
  description:
    'A tool declares every shape its period takes (two epoch-ms arguments, a joined range, a day, a ' +
    'look-back) and facts about its source. Under .time(), a period the model left out is filled ' +
    "from the turn's one window of the person's, exactly, and recorded as theirs; a window the model " +
    'chose runs as sent and is recorded model-chosen beside theirs; the tool is handed ctx.time.',
  defaultInput: 'Show client activity 10/09/26 8 AM to 8:40 AM',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// A fixture reader: the parts a tokenizer returns for "10/09/26 8 AM to 8:40 AM". The library,
// not the reader, turns them into a window — here under the app's declared date order.
const reader: TimeReader = {
  id: 'example/fixture',
  version: '1.0.0',
  locale: 'en-US',
  kind: 'rule',
  read: (text) =>
    text.includes('10/09/26')
      ? {
          mentions: [
            {
              quote: '10/09/26 8 AM to 8:40 AM',
              parses: [
                {
                  date: { kind: 'numeric', fields: [10, 9, 26] },
                  rangeOf: [
                    { wall: { h: 8, meridiem: 'am' } },
                    { wall: { h: 8, m: 40, meridiem: 'am' } },
                  ],
                },
              ],
            },
          ],
        }
      : { mentions: [] },
};

// #region period-forms
const handed: unknown[] = [];
const clientActivity = defineTool({
  name: 'client_activity',
  description: 'Client operations on the storage cluster over a window.',
  inputSchema: {
    type: 'object',
    properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } },
  },
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [
      {
        kind: 'bounds',
        from: { argument: 'start_time', as: 'epoch-ms' },
        to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
      },
    ],
    direction: 'past',
    retention: '30d',
  },
  execute: (args, ctx) => {
    handed.push({ args, time: ctx.time });
    return '{"ops":42}';
  },
});

const desk = Agent.create({
  provider: mock({
    replies: [
      { content: '', toolCalls: [{ id: 'c1', name: 'client_activity', args: {} }] },
      { content: '', toolCalls: [{ id: 'c2', name: 'client_activity', args: {} }] },
      { content: '42 client operations between 08:00 and 08:40.' },
    ],
  }),
  model: 'small-model',
})
  .tool(clientActivity)
  .time({ zone: 'America/Los_Angeles', reader, policy: { dateOrder: 'MDY' } })
  .build();
// #endregion period-forms

export async function run(input: string): Promise<string> {
  // The reading only proposes: the first call pauses until the person confirms the window.
  const asked = await desk.run({ message: input, time: { now: '2026-10-09T15:40:00Z' } });
  check(isInputPause(asked), 'the reading offered to confirm');
  if (!isInputPause(asked)) return String(asked);
  const out = await desk.resume(asked.checkpoint, {
    requestId: asked.awaitingInput.requestId,
    values: { f1: asked.awaitingInput.fields[0]?.enum?.[0] as string },
  });
  // The later call of the turn is filled from the confirmed window, in the tool's own form.
  console.log('the tool was handed:', JSON.stringify(handed[1], null, 2));
  const rows = (desk.findings() ?? []) as readonly { kind: string; toolCallId?: string }[];
  const window = rows.find((r) => r.kind === 'call-window' && r.toolCallId === 'c2');
  console.log('\ncall-window row:', JSON.stringify(window));
  check((window as { how?: string } | undefined)?.how === 'filled', 'the window filled');
  const args = rows.filter((r) => r.kind === 'argument' && r.toolCallId === 'c2') as {
    source?: string;
  }[];
  check(
    args.length === 2 && args.every((r) => r.source === 'answered'),
    "the arguments recorded as the person's answer",
  );
  return String(out);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
