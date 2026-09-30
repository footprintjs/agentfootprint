/**
 * 86 — the library's English reader: the person's time words read carefully,
 * served to the model in each tool's own form, and asked about only when a
 * tool needs a window the words did not settle.
 *
 *   .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
 *
 *   - the reader TOKENIZES a small, closed set — ISO dates, numeric dates
 *     (`10/09/26`, the order undecided), clock times, a range of two, a zone
 *     after them, today / yesterday / tomorrow, "last 40 minutes" — and says
 *     "unreadable" for every other time phrase ("yesterday morning", "last
 *     week"), never a partial reading;
 *   - a window it settled is served ONCE, on each tool that declares a period,
 *     in that tool's own form ("yesterday" → `start_time …, end_time …`), named
 *     a reading, never the person's words;
 *   - a window it could not settle is asked only when a tool that declares a
 *     period is about to be called: the zone first when the person wrote an
 *     abbreviation (`PST` — no map ships), then the readings as labelled
 *     choices; the chosen window is written into the tool's own arguments.
 *
 * Run:  npm run example examples/features/86-english-time-reader.ts
 */

import {
  Agent,
  defineTool,
  englishTimeReader,
  isInputPause,
  type LLMRequest,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/86-english-time-reader',
  title: "The English reader — the person's time words, read carefully and asked about lazily",
  group: 'features',
  description:
    'englishTimeReader() tokenizes a small, closed set of time phrases and says "unreadable" for ' +
    'the rest; a window it settled is served on each tool that declares a period, in the form ' +
    'that tool takes; one it could not settle ("10/09/26 … PST") is asked only when a tool needs ' +
    'it — the zone first, then the readings as labelled choices.',
  defaultInput: 'Show client activity 10/09/26 8 AM to 8:40 AM PST',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region english-reader
const handed: unknown[] = [];
const clientActivity = defineTool({
  name: 'client_activity',
  description: 'Client operations over a window.',
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
  },
  execute: (args) => {
    handed.push(args);
    return '{"ops":42}';
  },
});

/** An agent whose model calls the tool once, leaving the period out, then answers. */
function desk(served: string[]) {
  let calls = 0;
  return Agent.create({
    provider: mock({
      respond: (request: LLMRequest) => {
        calls += 1;
        const tool = request.tools?.find((t) => t.name === 'client_activity');
        if (tool !== undefined) served.push(tool.description);
        return calls === 1
          ? { content: '', toolCalls: [{ id: `c${calls}`, name: 'client_activity', args: {} }] }
          : { content: '42 client operations in that window.' };
      },
    }),
    model: 'small-model',
  })
    .tool(clientActivity)
    .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
    .build();
}
// #endregion english-reader

const time = { now: '2026-10-09T15:40:00Z' };

export async function run(input: string): Promise<string> {
  // 1. "yesterday" is settled: the model is served it in the tool's own form.
  const served: string[] = [];
  await desk(served).run({ message: 'Any client activity yesterday?', time });
  console.log('served on client_activity:', served[0]);
  check(served[0]?.includes('“yesterday” → start_time') === true, 'the served time sentence');

  // 2. The field sentence: the zone is asked for `PST`, then the three date orders.
  handed.length = 0;
  const agent = desk([]);
  const first = await agent.run({ message: input, time });
  check(isInputPause(first), 'a zone ask');
  if (!isInputPause(first)) return String(first);
  console.log('\nasked:', first.awaitingInput.fields[0]?.description);
  const second = await agent.resume(first.checkpoint, {
    requestId: first.awaitingInput.requestId,
    values: { f1: 'America/Los_Angeles' },
  });
  check(isInputPause(second), 'the readings as choices');
  if (!isInputPause(second)) return String(second);
  const field = second.awaitingInput.fields[0];
  console.log('asked:', field?.description);
  field?.enum?.forEach((value, i) => console.log(`  ${String(value)}  (${field.labels?.[i]})`));
  const done = await agent.resume(second.checkpoint, {
    requestId: second.awaitingInput.requestId,
    values: { f1: field?.enum?.[0] as string },
  });
  console.log('\nthe tool was handed:', JSON.stringify(handed));
  check(handed.length === 1, 'the tool ran once, on the chosen window');
  const rows = (agent.findings() ?? []) as readonly { kind: string; source?: string }[];
  check(
    rows.some((r) => r.kind === 'argument' && r.source === 'answered'),
    'the chosen window filed as the person’s answer',
  );
  return String(done);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
