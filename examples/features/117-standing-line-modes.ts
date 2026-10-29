/**
 * 117 — say the standing line only when it matters: `standingLine: { when }`.
 *
 * `.answerLayer({ standingLine: true })` appends one line to EVERY prose
 * answer — "Consistent with the run's record — …" included, which readers
 * learn to skip. `{ when: 'not-sure-or-ask' }` says the line only for "not
 * sure" and "ask" (`'unless-consistent'` leaves out only "consistent").
 *
 * The mode decides the LINE, nothing else: the standing still travels as data
 * on `turn_end.answerAssessment`, the limits block is appended whether or not
 * the line is, and memory keeps exactly the answer that was delivered. No line
 * is never a check — it means no reason fired, which includes "nothing could
 * be checked". The data still tells those apart.
 *
 * Run:  npm run example examples/features/117-standing-line-modes.ts
 */

import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/117-standing-line-modes',
  title: 'Say the standing line only when it matters — standingLine: { when }',
  group: 'features',
  description:
    'With { when: "not-sure-or-ask" } a consistent answer gets no line while a not-sure answer ' +
    'does; the standing still travels as data on turn_end in every mode.',
  defaultInput: 'Which ports on switch A are down?',
  // Scripted on purpose: the standing is pinned, which a live model would not reproduce.
  providerSlots: [],
  tags: ['features', 'observability', 'tools'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

// #region standing-line-modes
function portsAgent(execute: () => unknown, answer: string) {
  return Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'call-1', name: 'list_down_ports', args: { switch: 'A' } }] },
        { content: answer },
      ],
    }),
    model: 'small-model',
  })
    .tool(
      defineTool({
        name: 'list_down_ports',
        description: 'Ports that are down on one switch',
        inputSchema: { type: 'object', properties: { switch: { type: 'string' } } },
        execute,
      }),
    )
    .answerLayer({ standingLine: { when: 'not-sure-or-ask' } }) // the line only when it matters
    .build();
}

async function answerAndStanding(execute: () => unknown, answer: string, question: string) {
  const agent = portsAgent(execute, answer);
  let standing: string | undefined;
  agent.on('agentfootprint.agent.turn_end', (e) => {
    standing = e.payload.answerAssessment?.standing; // the data travels in every mode
  });
  const text = (await agent.run({ message: question })) as string;
  return { text, standing };
}
// #endregion standing-line-modes

export async function run(input: string): Promise<string> {
  const rows = await answerAndStanding(
    () => [{ port: 'eth1/7', since: '09:14' }],
    'Port eth1/7 on switch A is down.',
    input,
  );
  const empty = await answerAndStanding(() => [], 'No ports on switch A are down.', input);

  console.log(`${rows.standing} → ${rows.text}`);
  console.log(`${empty.standing} → ${empty.text}`);

  check(rows.standing === 'consistent', 'rows to read "consistent"');
  check(rows.text === 'Port eth1/7 on switch A is down.', 'no line, and no separator, for it');
  check(empty.standing === 'not-sure', 'a bare [] to read "not sure"');
  check(
    empty.text.endsWith(
      '\n\n---\n\nNot sure — a lookup came back empty without saying what it searched.',
    ),
    'the line where it matters',
  );
  return `${rows.standing}: no line · ${empty.standing}: line`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
