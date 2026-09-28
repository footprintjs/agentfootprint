/**
 * 76 — where each value came from, CHECKED: `.findings({ argumentSources: true })`.
 *
 * The person asks "any errors on checkout over the last week?". The log search's
 * period is the person's to give (`askOrAssume: { window: { ask, choices } }`), and
 * one choice carries words the author vouches for:
 *
 *   choices: [{ value: '7d', said: ['last week', 'past week'] }, '1h', '24h']
 *
 * With declared sources armed, the model says where each value came from, in
 * `_findings.from` — here, the person's own words as a `quote` — and the library
 * CHECKS the claim before anything runs:
 *
 *   - the quote is in the person's message, and it holds "last week", the phrase
 *     declared for `7d` → `source: 'said'`, `matched: 'phrase'`: the call runs;
 *   - a second turn sends `24h` quoting "any errors on checkout" — the words are
 *     the person's, the value is not in them: a READING. Under an `ask` rule a
 *     reading is asked, and the ask shows the person their own words (`quoted`) —
 *     never the model's value. The answer replaces the value, and the row says so.
 *
 * A pass keeps a reason from firing and supports nothing: the first answer's
 * standing reads "consistent with the record", never "known".
 *
 * Run:  npm run example examples/features/76-declared-sources.ts
 */

import { Agent, defineTool, isInputPause, type ArgumentRow } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/76-declared-sources',
  title: 'Where each value came from — the model declares it, the library checks it',
  group: 'features',
  description:
    'Under .findings({ argumentSources: true }) the model declares each argument value’s source in ' +
    '_findings.from (the person’s words as a quote, a result id, an earlier answer, the app, or ' +
    '"assumed"). The library checks the claim before the call runs: a declared phrase makes "over ' +
    'the last week" check out as 7d; a value the words do not hold is a reading, and the person is asked.',
  defaultInput: 'Any errors on checkout over the last week?',
  // Scripted on purpose: the model's declaration is the case, and a live model may not make it.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region declared-sources
function searchLogsTool(ran: Record<string, unknown>[]) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'],
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: ['1h', '24h', '7d'], description: 'Look-back.' },
      },
    },
    askOrAssume: {
      window: {
        ask: 'Which period should the error search cover?',
        // Words the author vouches for — matched as whole tokens, only inside a quote.
        choices: [{ value: '7d', said: ['last week', 'past week'] }, '1h', '24h'],
      },
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
        // Turn 1 — the model quotes the person's words for the period.
        {
          toolCalls: [
            {
              id: 'call-1',
              name: 'search_logs',
              args: {
                service: 'checkout',
                window: '7d',
                _findings: {
                  basis: 'direct',
                  from: [{ argument: 'window', source: 'user', quote: 'over the last week' }],
                },
              },
            },
          ],
        },
        { content: 'No errors on checkout in the last 7 days.' },
        // Turn 2 — the quote is the person's, but "24h" is not in it: a reading.
        {
          toolCalls: [
            {
              id: 'call-2',
              name: 'search_logs',
              args: {
                service: 'payments',
                window: '24h',
                _findings: {
                  basis: 'direct',
                  from: [{ argument: 'window', source: 'user', quote: 'and on payments' }],
                },
              },
            },
          ],
        },
        { content: 'No errors on payments in the last hour.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(searchLogsTool(ran))
    .findings({ argumentSources: true })
    .build();
}
// #endregion declared-sources

export async function run(input: string): Promise<string> {
  const ran: Record<string, unknown>[] = [];
  const agent = buildAgent(ran);

  // #region checked
  const first = await agent.run({ message: input });
  const standing = (await agent.assessment())!;
  console.log('turn 1:', first, '—', standing.standing);

  const paused = await agent.followUp('And on payments?');
  if (!isInputPause(paused)) throw new Error('expected the reading to be asked about');
  console.log(
    'asked, showing the person their words:',
    JSON.stringify(paused.awaitingInput.context),
  );
  const second = await agent.resume(paused.checkpoint, {
    requestId: paused.awaitingInput.requestId,
    values: { f1: '1h' },
  });
  // #endregion checked

  const rows = (agent.findings() ?? []).filter((r): r is ArgumentRow => r.kind === 'argument');
  console.log('\nthe tools ran with:', JSON.stringify(ran));
  console.log(
    'the ledger rows:   ',
    JSON.stringify(
      rows.map((r) => [
        r.toolCallId,
        r.asked ?? r.source,
        r.matched ?? r.reading ?? '',
        r.proposed ?? '',
      ]),
    ),
  );
  console.log('turn 2:', second);

  check(standing.standing === 'consistent', 'a checked quote to read "consistent", never "known"');
  check(
    rows[0]?.source === 'said' && rows[0]?.matched === 'phrase',
    'the phrase to check the quote',
  );
  check(
    rows.some((r) => r.asked === 'unverified' && r.reading === true),
    'the reading to be asked',
  );
  check(
    ran.length === 2 && ran[0]!.window === '7d' && ran[1]!.window === '1h',
    'the second call to run with the person’s answer, not the model’s reading',
  );
  return `${standing.standing} → asked → ${String(second)}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
