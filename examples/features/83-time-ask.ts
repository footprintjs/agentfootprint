/**
 * 83 — the time ask: the library checks a time answer before your app sees it.
 *
 * A tool asks the person for a window ("which window should the search
 * cover?"). The person types it backwards, or leaves the offset off, and every
 * app used to re-check shape, order and zone itself. Now the field says what
 * it is:
 *
 *   requestInput({ …, fields: [{ id: 'window', type: 'string', format: 'time-range' }] })
 *
 *   - `format: 'instant' | 'time-range' | 'zone'` — an ISO 8601 date-time with
 *     its offset, an interval `from/to` of two, an IANA zone name;
 *   - `agent.resume` judges the answer; one it refuses is NOT taken — the same
 *     ask comes back with `refused: { answer, reason }` and `repeat: { count }`,
 *     and nothing runs (no model call);
 *   - the reason is a catalog sentence (`defaultTimeAskMessages`), yours to
 *     reword through `.time({ messages })`; under `.time()` the person's zone is
 *     known, so a wall time the clocks skip is refused too;
 *   - `labels` name each choice, and a time field's choices keep free entry
 *     open unless `strict`; over MCP, `elicitationOf` carries the ask (a range
 *     as two `date-time` properties).
 *
 * Run:  npm run example examples/features/83-time-ask.ts
 */

import { Agent, defineTool, elicitationOf, isInputPause, requestInput } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/83-time-ask',
  title: 'The time ask — the library checks a time answer before your app sees it',
  group: 'features',
  description:
    'A requestInput field with format: "time-range" is judged at agent.resume: an answer that ends ' +
    'before it starts, has no offset, or (under .time()) names a wall time the clocks skip is not ' +
    'taken — the same ask comes back with refused { answer, reason } and repeat { count }, the reason ' +
    'a catalog sentence the app can reword, and nothing runs until a good answer arrives.',
  defaultInput: 'Any errors on checkout this morning?',
  providerSlots: [],
  tags: ['features', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region time-ask
const collectWindow = defineTool({
  name: 'collect_window',
  description: 'Ask the person which window the search should cover.',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    requestInput({
      id: 'search-window',
      question: 'Which window should the search cover?',
      fields: [{ id: 'window', type: 'string', format: 'time-range' }],
    }),
});

const desk = Agent.create({
  provider: mock({
    replies: [
      { content: '', toolCalls: [{ id: 'c1', name: 'collect_window', args: {} }] },
      { content: 'No errors on checkout in that window.' },
    ],
  }),
  model: 'small-model',
})
  .tool(collectWindow)
  .time({
    zone: 'America/Los_Angeles',
    messages: { 'answer.out-of-order': 'That window ends ({{to}}) before it starts ({{from}}).' },
  })
  .build();
// #endregion time-ask

export async function run(input: string): Promise<string> {
  const time = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' };
  const first = await desk.run({ message: input, time });
  if (!isInputPause(first)) throw new Error('expected the ask');
  console.log('asked:', first.awaitingInput.question);
  console.log(
    'over MCP:',
    JSON.stringify(elicitationOf(first.awaitingInput).requestedSchema.properties),
  );

  // 1. Backwards: refused in the app's words, asked again — nothing ran.
  const backwards = await desk.resume(first.checkpoint, {
    requestId: first.awaitingInput.requestId,
    values: { window: '2026-10-09T08:40-07:00/2026-10-09T08:00-07:00' },
  });
  if (!isInputPause(backwards)) throw new Error('expected the re-ask');
  console.log('\nrefused:', backwards.awaitingInput.refused?.reason);
  console.log('repeat:', JSON.stringify(backwards.awaitingInput.repeat));
  check(backwards.awaitingInput.repeat?.count === 1, 'the re-ask counted');

  // 2. No offset: the catalog's own sentence.
  const zoneless = await desk.resume(backwards.checkpoint, {
    requestId: backwards.awaitingInput.requestId,
    values: { window: '2026-10-09T08:00/2026-10-09T08:40' },
  });
  if (!isInputPause(zoneless)) throw new Error('expected the re-ask');
  console.log('refused:', zoneless.awaitingInput.refused?.reason);
  check(zoneless.awaitingInput.repeat?.count === 2, 'the second re-ask counted');

  // 3. A good answer runs.
  const answer = await desk.resume(zoneless.checkpoint, {
    requestId: zoneless.awaitingInput.requestId,
    values: { window: '2026-10-09T08:00-07:00/2026-10-09T08:41-07:00' },
  });
  check(typeof answer === 'string', 'the run finished');
  return String(answer);
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
