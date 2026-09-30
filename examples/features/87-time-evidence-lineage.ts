/**
 * 87 — evidence lineage at grain: the evidence gate tells the person's time
 * words from the library's spellings of them.
 *
 *   .time({ zone, reader: englishTimeReader() }) + .namesAndNumbersFromEvidence()
 *
 *   - a part the person WROTE, at the grain they wrote it, is theirs: "8 AM"
 *     is also `8:00` and `08:00`, a confirmed `10/09/26` is `2026-10-09` —
 *     exempt, like their words;
 *   - what the LIBRARY produced from the reading — the end of the said minute
 *     (`08:41` for "8:40 AM"), `-07:00`, `PDT` for a said `PST`, `15:00Z`, the
 *     epoch the call ran with, the served time line — is never called
 *     invented and never the person's: one `time-derived` row, and the
 *     answer's standing folds `derived-from-reading` — "not sure";
 *   - a time no reading produced is still flagged.
 *
 * One owner decides which spelling is whose: `core/time/forms.ts` · `timeFormsOf`.
 *
 * Run:  npm run example examples/features/87-time-evidence-lineage.ts
 */

import { Agent, defineTool, englishTimeReader, isInputPause } from '../../src/index.js';
import { assessAnswer } from '../../src/observe.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/87-time-evidence-lineage',
  title: "Evidence lineage at grain — the person's time words, the library's spellings",
  group: 'features',
  description:
    'Under .time() beside the evidence gate, the parts of a time the person wrote are theirs ' +
    '("8 AM" is also 08:00), the spellings the library derived from the reading (08:41, -07:00, ' +
    'PDT, the epoch the call ran with) are filed as derived-from-reading — "not sure", never ' +
    'invented — and a time nobody read is still flagged.',
  defaultInput: 'Show client activity 10/09/26 8 AM to 8:40 AM PST',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region evidence-lineage
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
  execute: () => '{"ops":42}',
});

/** The model calls the tool with the period left out, then answers `answer`. */
function desk(answer: string) {
  let calls = 0;
  return Agent.create({
    provider: mock({
      respond: () => {
        calls += 1;
        return calls === 1
          ? { content: '', toolCalls: [{ id: 'c1', name: 'client_activity', args: {} }] }
          : { content: answer };
      },
    }),
    model: 'small-model',
  })
    .tool(clientActivity)
    .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();
}
// #endregion evidence-lineage

const time = { now: '2026-10-09T15:40:00Z' };

/** The field run: the zone for `PST` answered, the first reading confirmed, then the answer. */
async function fieldRun(message: string, answer: string) {
  const agent = desk(answer);
  const first = await agent.run({ message, time });
  if (!isInputPause(first)) throw new Error('expected the zone ask');
  const second = await agent.resume(first.checkpoint, {
    requestId: first.awaitingInput.requestId,
    values: { f1: 'America/Los_Angeles' },
  });
  if (!isInputPause(second)) throw new Error('expected the readings');
  await agent.resume(second.checkpoint, {
    requestId: second.awaitingInput.requestId,
    values: { f1: second.awaitingInput.fields[0]?.enum?.[0] as string },
  });
  const rows = (agent.findings() ?? []) as readonly { kind: string; values?: string[] }[];
  return {
    flagged: agent.unsupportedValues()?.values.map((v) => v.value) ?? [],
    derived: rows.filter((r) => r.kind === 'time-derived').flatMap((r) => r.values ?? []),
    standing: assessAnswer({ snapshot: agent.getLastSnapshot() }).standing,
  };
}

export async function run(input: string): Promise<string> {
  const warn = console.warn;
  console.warn = () => undefined; // the gate's flag warning — printed below instead
  try {
    // 1. The person's parts at grain: clean.
    const theirs = await fieldRun(input, 'From 8:00 to 08:40 on 2026-10-09: 42 operations.');
    console.log('their parts   → flagged', theirs.flagged, 'derived', theirs.derived);
    check(theirs.flagged.length === 0 && theirs.derived.length === 0, 'the person’s parts clean');

    // 2. The library's spellings: derived — "not sure", never invented.
    const library = await fieldRun(input, 'From 15:00Z (-07:00) until 08:41: 42 operations.');
    console.log('library spellings → flagged', library.flagged, 'derived', library.derived);
    console.log('  standing:', library.standing);
    check(library.flagged.length === 0, 'nothing called invented');
    check(library.derived.includes('08:41'), 'the end of the said minute is the library’s');
    check(library.standing === 'not-sure', 'derived-from-reading folds "not sure"');

    // 3. A time nobody read: still flagged.
    const invented = await fieldRun(input, 'At 09:15 in 2031 there were 42 operations.');
    console.log('invented      → flagged', invented.flagged);
    check(invented.flagged.includes('09:15') && invented.flagged.includes('2031'), 'still flagged');
    return library.standing;
  } finally {
    console.warn = warn;
  }
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
