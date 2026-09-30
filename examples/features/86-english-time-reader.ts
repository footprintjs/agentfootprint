/**
 * 86 — the library's English reader: the person's time words read carefully,
 * PROPOSED to the person with their window and zone, and — once the person
 * confirms — served to the model in each tool's own form.
 *
 *   .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
 *
 *   - the reader TOKENIZES a small, closed set — ISO dates, numeric dates
 *     (`10/09/26`, the order undecided), clock times, a range of two, a zone
 *     after them, today / yesterday / tomorrow, "last 40 minutes" — and says
 *     "unreadable" for every other time phrase ("yesterday morning", "last
 *     week"), never a partial reading;
 *   - a reading only PROPOSES (the owner's decision "Always confirm"): nothing
 *     typed in chat is filed as the person's words. When a tool that declares
 *     a period is about to be called, the reading is offered as a pre-filled,
 *     editable one-click confirmation naming its window AND its zone ("I read
 *     “yesterday” as Thu, Oct 8, 2026, PDT in America/Los_Angeles — is that
 *     right?") — the zone asked first when the person wrote an abbreviation
 *     (`PST` — no map ships; an app that declares `policy.abbreviations`
 *     gets ONE confirmation offering the zone's reading and the letters'),
 *     and a zone named by place stays the person's (`yesterday London time`
 *     is the London day). The click is recorded (`time-answer`,
 *     `how: 'confirmed'`); a window the person writes instead is theirs too
 *     (`how: 'edited'`); the window is written into the tool's own arguments;
 *   - once confirmed, the window is served to the model LATE — one time line
 *     appended last to the request, never on a tool description — naming
 *     each tool that declares a period in that tool's own form, with its
 *     source ("the window the person confirmed when asked what their words
 *     meant").
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
    'the rest; every reading is only a proposal, confirmed in one click with its window and zone ' +
    '("10/09/26 … PST": the zone first, then the readings as labelled choices); once confirmed ' +
    'it is served late, in one time line at the end of the request, in the form each tool takes.',
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

/** The app's own abbreviations, as data — no map ships; each maps to its zone AND its letters' offset. */
const US_WEST = { PST: { zone: 'America/Los_Angeles', offset: '-08:00' } };

/** An agent whose model calls the tool once, leaving the period out, then answers. */
function desk(served: string[], policy?: { dateOrder: 'MDY'; abbreviations: typeof US_WEST }) {
  let calls = 0;
  return Agent.create({
    provider: mock({
      respond: (request: LLMRequest) => {
        calls += 1;
        // The time line is served LATE: the request's last message, never a tool description.
        const last = request.messages.at(-1);
        served.push(typeof last?.content === 'string' ? last.content : '');
        return calls === 1
          ? { content: '', toolCalls: [{ id: `c${calls}`, name: 'client_activity', args: {} }] }
          : { content: '42 client operations in that window.' };
      },
    }),
    model: 'small-model',
  })
    .tool(clientActivity)
    .time({
      zone: 'America/Los_Angeles',
      reader: englishTimeReader(),
      ...(policy !== undefined && { policy }),
    })
    .build();
}
// #endregion english-reader

const time = { now: '2026-10-09T15:40:00Z' };

export async function run(input: string): Promise<string> {
  // 1. "yesterday" is only PROPOSED: nothing is served, the call pauses on a one-click
  //    confirmation naming the window and its zone.
  const served: string[] = [];
  const proposal = desk(served);
  const asked = await proposal.run({ message: 'Any client activity yesterday?', time });
  check(isInputPause(asked), 'a confirmation');
  if (!isInputPause(asked)) return String(asked);
  const offer = asked.awaitingInput.fields[0];
  console.log('asked:', offer?.description);
  console.log('  offered:', offer?.labels?.[0]);
  check(offer?.labels?.[0]?.includes('in America/Los_Angeles') === true, 'the window and its zone');
  check(served[0]?.includes('Time words') !== true, 'nothing served before the confirmation');
  await proposal.resume(asked.checkpoint, {
    requestId: asked.awaitingInput.requestId,
    values: { f1: offer?.enum?.[0] as string },
  });
  const answers = ((proposal.findings() ?? []) as readonly { kind: string; how?: string }[]).filter(
    (r) => r.kind === 'time-answer',
  );
  check(answers[0]?.how === 'confirmed', 'the click recorded as the person’s answer');
  console.log('the time line served after the click:', served[1]);
  check(
    served[1]?.includes('the window the person confirmed when asked what their words meant') ===
      true,
    'the served line names the confirmed window and its source',
  );

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

  // 3. A zone the person names stays theirs: "yesterday London time" is proposed as the London day.
  const london = desk([]);
  const named = await london.run({ message: 'Any client activity yesterday London time?', time });
  check(isInputPause(named), 'a confirmation of the London day');
  if (!isInputPause(named)) return String(named);
  console.log('\noffered:', named.awaitingInput.fields[0]?.labels?.[0]);
  check(
    named.awaitingInput.fields[0]?.enum?.[0] ===
      '2026-10-08T00:00:00+01:00/2026-10-09T00:00:00+01:00',
    'the day in Europe/London, never the app zone',
  );

  // 4. With the app's own map and date order, the field sentence is ONE confirmation: PST as
  //    the zone's −07:00 and as its letters' −08:00 — offered both ways, never corrected.
  const mapped = desk([], { dateOrder: 'MDY', abbreviations: US_WEST });
  const once = await mapped.run({ message: input, time });
  check(isInputPause(once), 'one confirmation');
  if (!isInputPause(once)) return String(once);
  const both = once.awaitingInput.fields[0];
  console.log('asked:', both?.description);
  both?.enum?.forEach((value, i) => console.log(`  ${String(value)}  (${both.labels?.[i]})`));
  check(both?.format === 'time-range' && both.enum?.length === 2, 'both readings of PST, one ask');
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
