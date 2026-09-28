/**
 * 75 — a value only the person can give, asked ONCE, before anything runs: `askOrAssume`'s `ask`.
 *
 * Two services, one question: "any errors on checkout or payments?". The model
 * calls the log search twice and leaves the look-back period out of both. A
 * default here would be a period nobody chose — so the tool author declares
 * that the PERSON gives it:
 *
 *   askOrAssume: { window: { ask: 'Which period should the error search cover?',
 *                            choices: ['1h', '24h', '7d'] } }
 *
 * and the library:
 *
 *   - asks ONCE for the whole batch, before either call runs — one field, bound to
 *     both calls, through the typed ask `requestInput` uses (`isInputPause`);
 *   - files an `argument` row `asked: 'missing'` per call, and the answer's
 *     standing reads ASK while the question is out (`argument-asked`);
 *   - on `agent.resume(checkpoint, { requestId, values })` fills the answer into
 *     both calls, files `answered` rows, and runs the batch — no extra model call;
 *   - tells the model, on each result, that the period was the person's answer.
 *
 * Run:  npm run example examples/features/75-ask-for-missing-arguments.ts
 */

import { Agent, defineTool, isInputPause, type ArgumentRow } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/75-ask-for-missing-arguments',
  title: 'A value only the person can give — asked once for the whole batch (askOrAssume: ask)',
  group: 'features',
  description:
    'A tool declares askOrAssume: { window: { ask, choices } }. The model calls it twice without the ' +
    'period; the library asks the person ONCE, before anything runs, files asked then answered rows, ' +
    'and runs both calls with the answer — the standing reads "ask" until the answer comes.',
  defaultInput: 'Any errors on checkout or payments?',
  // Scripted on purpose: the model's omission is the case, and a live model may not omit.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region ask-for-missing-arguments
function searchLogsTool(ran: Record<string, unknown>[]) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'], // the author's contract — never edited
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: ['1h', '24h', '7d'], description: 'Look-back.' },
      },
    },
    // The PERSON gives the period: a missing one is asked, once per batch.
    askOrAssume: {
      window: { ask: 'Which period should the error search cover?', choices: ['1h', '24h', '7d'] },
    },
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, window: args.window, errors: 0 };
    },
  });
}

function buildAgent(ran: Record<string, unknown>[]) {
  return Agent.create({
    provider: mock({
      replies: [
        // Two calls, neither with a period — the omission this example is about.
        {
          toolCalls: [
            { id: 'call-1', name: 'search_logs', args: { service: 'checkout' } },
            { id: 'call-2', name: 'search_logs', args: { service: 'payments' } },
          ],
        },
        { content: 'No errors on checkout or payments in the last 7 days.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(searchLogsTool(ran))
    .build();
}
// #endregion ask-for-missing-arguments

export async function run(input: string): Promise<string> {
  const ran: Record<string, unknown>[] = [];
  const agent = buildAgent(ran);

  // #region the-ask
  const paused = await agent.run({ message: input });
  if (!isInputPause(paused)) throw new Error('expected the library to ask for the period');
  const ask = paused.awaitingInput;
  console.log('asked:', ask.question);
  console.log('field:', JSON.stringify(ask.fields));
  console.log('for:  ', JSON.stringify(ask.context));
  const waiting = (await agent.assessment())!;
  console.log(
    'standing while it waits:',
    waiting.standing,
    waiting.reasons.map((r) => r.reason),
  );

  // The person answers — the host stored the checkpoint; any process can resume it.
  const answer = await agent.resume(paused.checkpoint, {
    requestId: ask.requestId,
    values: { f1: '7d' },
  });
  // #endregion the-ask

  const rows = (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');
  console.log('\nthe tools ran with:', JSON.stringify(ran));
  console.log(
    'the ledger rows:   ',
    JSON.stringify(rows.map((r) => [r.toolCallId, r.asked ?? r.source])),
  );
  console.log('the answer:        ', answer);

  check(ask.fields.length === 1, 'ONE field for the whole batch');
  check(
    ran.length === 2 && ran.every((r) => r.window === '7d'),
    'both calls to run with the answer',
  );
  check(waiting.standing === 'ask', 'the standing to read "ask" while the question is out');
  check(rows.filter((r) => r.source === 'answered').length === 2, 'an answered row for each call');
  return `${waiting.standing} → ${String(answer)}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
