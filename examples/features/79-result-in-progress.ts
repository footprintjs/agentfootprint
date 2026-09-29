/**
 * 79 — in progress is its own outcome: a result says what it found still running.
 *
 * A replication tool reads every session on an array. 135 are settled, none has
 * failed — and 96 are still synchronizing. A tool that tests "equals the success
 * value" reports "96 non-OK sessions", and someone gets paged for nothing. A vendor
 * state machine has at least three outcomes: settled-ok, in progress, failed.
 *
 * The TOOL knows which of its vendor's states are in flight (and when the vendor
 * gives its own verdict field, that verdict wins over a state name). So the tool
 * classifies, and says so on the result it already returns:
 *
 *   coverage(summary, { checked: [...],
 *                       inProgress: [{ what: 'sessions still synchronizing', count: 96 }] })
 *
 * — the library never reads a state name. What it does with the declaration:
 *
 *   - the model reads `in_progress` and one static sentence after the note: the
 *     outcome is not known yet, neither a success nor a failure;
 *   - the record keeps it (`tools.coverage_declared`, the `coverageDeclared` row);
 *   - with `.limitsTravelWithTheAnswer()`, the answer carries an
 *     "In progress (outcome not known yet)" section;
 *   - the answer's standing does NOT change — it is a label, not a reason.
 *
 * Run:  npm run example examples/features/79-result-in-progress.ts
 */

import { Agent, coverage, defineTool, type DeclaredCoverage } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/79-result-in-progress',
  title: 'In progress is its own outcome — a result says what it found still running',
  group: 'features',
  description:
    'A replication tool reads 231 sessions: 135 settled, none failed, 96 still synchronizing. It ' +
    'declares the 96 as in progress (coverage(summary, { checked, inProgress })) instead of counting ' +
    'them as failures; the model reads that their outcome is not known yet, the record keeps them, ' +
    'and .limitsTravelWithTheAnswer() prints an "In progress" section. The standing is unchanged.',
  defaultInput: 'Any unhealthy replication sessions on array-8?',
  // Scripted on purpose: the in-flight sessions are the tool's data, not the model's.
  providerSlots: [],
  tags: ['features', 'tools', 'observability'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** The array's own read — the vendor reports a state AND its own verdict per session. */
const sessions = [
  ...Array.from({ length: 135 }, (_, i) => ({ id: `s${i}`, state: 'SYNCED', healthy: true })),
  ...Array.from({ length: 96 }, (_, i) => ({ id: `t${i}`, state: 'SYNCING', healthy: true })),
];

// #region result-in-progress
const replicationSessions = defineTool({
  name: 'replication_sessions',
  description: 'Replication sessions on one array: settled, still transferring, and failed.',
  inputSchema: { type: 'object', properties: { array: { type: 'string' } }, required: ['array'] },
  execute: ({ array }: { array: string }) => {
    // The TOOL classifies: the vendor's own verdict decides a failure; a healthy
    // session that is still transferring is in progress — never "non-OK".
    const failed = sessions.filter((s) => !s.healthy);
    const running = sessions.filter((s) => s.healthy && s.state === 'SYNCING');
    return coverage(
      { failed: failed.length, settled: sessions.length - failed.length - running.length },
      {
        checked: [`every replication session on ${array} (live query)`],
        inProgress: running.length
          ? [{ what: 'sessions still synchronizing', count: running.length, short: 'syncing' }]
          : [],
      },
    );
  },
});
// #endregion result-in-progress

function build() {
  return Agent.create({
    provider: mock({
      replies: [
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'replication_sessions', args: { array: 'array-8' } }],
        },
        { content: 'No session has failed. 135 are settled and 96 are still synchronizing.' },
      ],
    }),
    model: 'small-model',
  })
    .tool(replicationSessions)
    .limitsTravelWithTheAnswer()
    .answerLayer()
    .build();
}

export async function run(input: string): Promise<string> {
  const agent = build();
  const answer = String(await agent.run({ message: input }));
  console.log(answer);

  const state = agent.getLastSnapshot()?.sharedState as { coverageDeclared?: DeclaredCoverage[] };
  const row = state.coverageDeclared?.[0];
  console.log('\nthe coverageDeclared row:', JSON.stringify(row?.inProgress));
  check(row?.inProgress?.[0]?.count === 96, 'the row to carry the 96 in-flight sessions');
  check(
    answer.includes(
      'In progress (outcome not known yet):\n- replication_sessions: sessions still synchronizing (96)',
    ),
    'the answer to carry the In progress section',
  );

  const standing = (await agent.assessment())!;
  console.log(
    'standing:',
    standing.standing,
    standing.reasons.map((r) => r.reason),
  );
  check(
    !standing.reasons.some((r) => String(r.reason).includes('progress')),
    'no standing reason from the declaration — it is a label',
  );
  return `${standing.standing} · in progress: ${row?.inProgress?.[0]?.count ?? 0}`;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
