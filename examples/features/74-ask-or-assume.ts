/**
 * 74 — a default nobody chose, filled by the library and admitted: `askOrAssume`.
 *
 * A log search defaults its look-back period to 2 hours. Asked "any errors on
 * checkout?", the model leaves the period out, the tool runs on 2h, and the
 * answer "no errors" silently means "no errors in a window nobody chose".
 *
 * Declare the default as a RULE instead of burying it in the tool:
 *
 *   askOrAssume: { window: { assume: '2h' } }
 *
 * and the library — never the tool — fills the value, and the record says so:
 *
 *   - the tool runs with `window: '2h'`;
 *   - the findings ledger gets an `argument` row: `source: 'default'`;
 *   - the model reads a note on the result: the call ran with "2h", the value the
 *     tool's rule assumes;
 *   - the answer's standing reads NOT SURE, naming the assumption
 *     (`argument-assumed`) — never "consistent" on a value nobody gave;
 *   - with `.limitsTravelWithTheAnswer()`, the answer itself carries an
 *     "Assumed (a tool's rule, not your words)" block.
 *
 * Run:  npm run example examples/features/74-ask-or-assume.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/74-ask-or-assume',
  title: 'A default nobody chose — the library fills it, files it and admits it (askOrAssume)',
  group: 'features',
  description:
    'A tool declares askOrAssume: { window: { assume: "2h" } }. The model leaves the period out; the ' +
    'library fills it, files an argument row (source: default), tells the model in a note, and the ' +
    'answer’s standing reads "not sure — assumed". With .limitsTravelWithTheAnswer() the answer ' +
    'carries an "Assumed" block.',
  defaultInput: 'Any errors on checkout?',
  // Scripted on purpose: the model's omission is the case, and a live model may not omit.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region ask-or-assume
function searchLogsTool(ran: Record<string, unknown>[]) {
  return defineTool({
    name: 'search_logs',
    description: 'Error lines for one service over a look-back period.',
    inputSchema: {
      type: 'object',
      required: ['service', 'window'], // the author's contract — never edited
      properties: {
        service: { type: 'string', description: 'Service name.' },
        window: { type: 'string', enum: ['1h', '2h', '24h', '7d'], description: 'Look-back.' },
      },
    },
    // The default, declared: the LIBRARY fills it when a call leaves it out.
    askOrAssume: { window: { assume: '2h' } },
    // …and it is the argument that bounds the period the answer covers.
    period: { argument: 'window', spelling: 'lookback' },
    execute: async (args) => {
      ran.push({ ...args });
      return { service: args.service, window: args.window, errors: 0 };
    },
  });
}

async function ask(message: string, limitsTravel: boolean) {
  const ran: Record<string, unknown>[] = [];
  let builder = Agent.create({
    provider: mock({
      replies: [
        // The model leaves `window` out — the omission this example is about.
        { toolCalls: [{ id: 'call-1', name: 'search_logs', args: { service: 'checkout' } }] },
        { content: 'No errors on checkout.' },
      ],
    }),
    model: 'small-model',
  }).tool(searchLogsTool(ran));
  if (limitsTravel) builder = builder.limitsTravelWithTheAnswer();
  const agent = builder.build();
  const answer = await agent.run({ message });
  return { agent, answer: String(answer), ran };
}
// #endregion ask-or-assume

export async function run(input: string): Promise<string> {
  const plain = await ask(input, false);
  const row = (plain.agent.findings() ?? []).find((r) => r.kind === 'argument');
  const standing = (await plain.agent.assessment())!;

  console.log('the tool ran with:', JSON.stringify(plain.ran[0]));
  console.log('the ledger row:   ', JSON.stringify(row));
  console.log(
    'the standing:     ',
    standing.standing,
    standing.reasons.map((r) => r.reason),
  );

  check(plain.ran[0]?.window === '2h', 'the library to fill the declared default');
  check(row?.kind === 'argument' && row.source === 'default', 'a default row on the ledger');
  check(row?.kind === 'argument' && row.proposed === undefined, 'no proposal: the model left it out');
  check(standing.standing === 'not-sure', 'the answer to read "not sure"');
  check(
    standing.reasons.some((r) => r.reason === 'argument-assumed'),
    'the standing to name the assumption',
  );

  const travelled = await ask(input, true);
  console.log('\nwith .limitsTravelWithTheAnswer():\n' + travelled.answer);
  check(
    travelled.answer.includes("Assumed (a tool's rule, not your words):") &&
      travelled.answer.includes('- window = "2h" (search_logs)'),
    'the answer to carry the Assumed block',
  );
  return `${standing.standing} · ${standing.reasons.map((r) => r.reason).join(', ')}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
