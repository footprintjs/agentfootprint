/**
 * 66 — described tool results + check:semantics.
 *
 * The ask came from a triage-platform team with seventy tools: every honest
 * tool re-implemented the same caveats by hand — the collection interval,
 * whether the values are counters that must never be summed, when the world
 * was actually measured, which clusters were NOT collected — and review was
 * the only thing keeping them there. Culture scales to one disciplined
 * author. It does not scale to a hundred tools.
 *
 * `describedResult({...})` makes those caveats TYPED DATA that travel with
 * the values, and `check:semantics` is the build gate that refuses a tool
 * that forgot them — by tool name and field name. (`semantic()` is the
 * deprecated name for the same envelope, declared in snake_case.)
 *
 * Five things this example shows, in order:
 *
 *   1. Two views of one envelope — the MODEL reads a compact rendering-free
 *      projection (data + grain + provenance + `not_covered`); the RECORD
 *      gets the full envelope on `agentfootprint.tools.semantics_declared`,
 *      render hints, coverage detail and all.
 *   2. The coverage absorb — the envelope's `coverage` field flows through
 *      the same channel `coverage()` uses, so `.limitsTravelWithTheAnswer()`
 *      appends it to the final answer with zero extra wiring.
 *   3. One `execute`, three helpers — rows from the system of record go out
 *      through `describedResult()`, a verdict through `coverage()`, and
 *      nothing-matched through `absent()`, each with the same declared
 *      ground. What the model reads for each is captured by `modelViews()`.
 *   4. The gate — `checkSemantics` passes the honest tool, then fails a
 *      deliberately broken triage tool BY NAME, naming the missing field.
 *   5. An empty list is not "nothing matched" — `describedResult({ facts: [] })`
 *      is refused, and the refusal names the branch to write: `absent()`.
 *
 * Every value in a declaration comes from the data: `measuredAt` is the
 * export's own timestamp, never a date typed into the tool.
 *
 * Run:  npm run example examples/features/66-semantic-envelope.ts
 */

import {
  Agent,
  absent,
  coverage,
  defineTool,
  describedResult,
  type LLMProvider,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { checkSemantics, formatSemanticsReport } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/66-semantic-envelope',
  title: 'Described tool results — caveats that travel with the numbers, and a gate that enforces them',
  group: 'features',
  description:
    'A triage tool returns describedResult({ series, grain, provenance, coverage }): the model reads a ' +
    'compact projection, the record keeps the full envelope, one execute picks describedResult / ' +
    'coverage / absent by what it found, and check:semantics fails a triage tool that forgot its ' +
    'coverage — naming the tool and the field.',
  defaultInput: 'Is the backup posture for vm-01 healthy?',
  providerSlots: ['default'],
  tags: ['features', 'tools', 'observability', 'governance'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/**
 * The system of record: the nightly export of the backup clusters. The export
 * carries its own timestamp — the moment the WORLD was measured — and that is
 * the only place a declaration below takes a time from.
 */
export const backupExport = {
  exportedAt: '2026-08-19T10:12:00Z',
  source: 'Cohesity API export (4 clusters)',
  runs: [
    { vm: 'vm-01', day: '2026-08-18', ok: 1, copies: 1 },
    { vm: 'vm-01', day: '2026-08-19', ok: 1, copies: 1 },
    { vm: 'vm-02', day: '2026-08-19', ok: 0, copies: 0 },
  ],
};

/** The honest triage tool: a verdict WITH its boundary, as data. */
// #region described-result
const backupStatus = defineTool({
  name: 'vm_backup_status',
  description: 'Backup posture for one VM across the Cohesity clusters',
  resultClass: 'triage',
  inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
  execute: ({ vm }: { vm: string }) => {
    const { exportedAt, source, runs: all } = backupExport;
    const runs = all.filter((r) => r.vm === vm); // the export lists runs oldest first
    const latest = runs[runs.length - 1];
    if (latest === undefined) {
      return absent({ what: `backup runs for ${vm}`, checked: [`every backup job in the export of ${exportedAt}`] });
    }
    return describedResult({
      facts: [{ entity: vm, backed_up: latest.ok === 1, copies: latest.copies, runs_seen: runs.length }],
      series: runs.map((r) => ({ t: r.day, entity: vm, metric: 'backup_runs_ok', value: r.ok })),
      // Each value counts ONE day's successful runs, so adding days gives the
      // week's total: a per-day count is not a counter (isCounter: false). A
      // cumulative total since the job was created would be isCounter: true.
      grain: { interval: 'daily', aggregation: 'count', isCounter: false },
      provenance: { measuredAt: exportedAt, source }, // the export's own timestamp
      coverage: {
        checked: [`every backup job in the export of ${exportedAt}`],
        cannotCover: [{ what: 'PPDM', why: 'not collected on this install' }],
      },
      render: { default: 'table', columns: ['entity', 'backed_up', 'copies'], sort: 'entity' },
    });
  },
});
// #endregion described-result

// #region three-helpers
const vmBackups = defineTool({
  name: 'vm_backups',
  description: 'Backup runs for one VM, or a one-line verdict with summary: true',
  inputSchema: {
    type: 'object',
    properties: { vm: { type: 'string' }, summary: { type: 'boolean' } },
    required: ['vm'],
  },
  execute: ({ vm, summary }: { vm: string; summary?: boolean }) => {
    const { exportedAt, source, runs: all } = backupExport;
    const runs = all.filter((r) => r.vm === vm);
    // The ground every answer stands on — declared once, used by all three.
    const ground = {
      checked: [`every backup job in the export of ${exportedAt}`],
      cannotCover: [{ what: 'PPDM', why: 'not collected on this install' }],
    };
    // Nothing matched → absent(): "I looked and there is nothing".
    if (runs.length === 0) return absent({ what: `backup runs for ${vm}`, ...ground });
    // A value that is not rows (a verdict, prose, someone else's object) → coverage().
    if (summary === true) {
      const ok = runs.filter((r) => r.ok === 1).length;
      return coverage(`${vm}: ${ok} of ${runs.length} backup runs succeeded`, ground);
    }
    // Rows from the system of record → describedResult(), time taken from the data.
    return describedResult({
      facts: runs.map((r) => ({ entity: vm, day: r.day, ok: r.ok === 1 })),
      provenance: { measuredAt: exportedAt, source },
      coverage: ground,
    });
  },
});
// #endregion three-helpers

/** The broken sibling: a triage verdict with NO boundary — the gate's prey. */
const brokenTriage = defineTool({
  name: 'nas_share_triage',
  description: 'Walk the share -> filesystem -> server path for one NAS share',
  resultClass: 'triage',
  inputSchema: { type: 'object', properties: { share: { type: 'string' } } },
  execute: () => ({ steps_ok: 7, verdict: 'no fault found' }), // no coverage anywhere
});

const oneTurn = (): LLMProvider =>
  mock({
    replies: [
      { toolCalls: [{ id: 'call-backup-1', name: 'vm_backup_status', args: { vm: 'vm-01' } }] },
      { content: 'Backed up — two successful daily runs. Note: PPDM is not collected here.' },
    ],
  });

/** The text of every `role: 'tool'` message the model was sent, in order. */
function toolMessagesOf(agent: Agent): string[] {
  const history = (agent.getLastSnapshot()?.sharedState as { history: Array<{ role: string; content: unknown }> })
    .history;
  return history
    .filter((m) => m.role === 'tool')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
}

/**
 * What the MODEL reads for each of the three helpers — one run, three calls to
 * `vm_backups`, the tool messages captured from the conversation the model
 * was sent. The docs print these bytes, and a test holds them to this run.
 */
export async function modelViews(): Promise<{ described: string; covered: string; absent: string }> {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'c1', name: 'vm_backups', args: { vm: 'vm-01' } }] },
        { toolCalls: [{ id: 'c2', name: 'vm_backups', args: { vm: 'vm-01', summary: true } }] },
        { toolCalls: [{ id: 'c3', name: 'vm_backups', args: { vm: 'vm-99' } }] },
        { content: 'vm-01: 2 of 2 runs succeeded; vm-99 has no backup runs.' },
      ],
    }),
    model: 'small-model',
    maxIterations: 6,
  })
    .system('You audit backup posture.')
    .tool(vmBackups)
    .build();
  await agent.run({ message: 'Check vm-01 and vm-99.' });
  const [described = '', covered = '', nothing = ''] = toolMessagesOf(agent);
  return { described, covered, absent: nothing };
}

export async function run(input: string, provider?: LLMProvider): Promise<string> {
  // ── 1. Two views of one envelope ────────────────────────────────────────
  const agent = Agent.create({ provider: provider ?? oneTurn(), model: 'small-model', maxIterations: 3 })
    .system('You audit backup posture.')
    .tool(backupStatus)
    .limitsTravelWithTheAnswer()
    .build();

  const recorded: Array<Record<string, unknown>> = [];
  agent.on('agentfootprint.tools.semantics_declared', (e) =>
    recorded.push(e.payload as unknown as Record<string, unknown>),
  );

  const answer = await agent.run({ message: input });
  if (typeof answer !== 'string') throw new Error('Agent paused unexpectedly.');

  const modelView = toolMessagesOf(agent)[0] ?? '';

  console.log('1. What the MODEL read (the compact projection — caveats travel with the numbers):\n');
  console.log(`   ${modelView.slice(0, 220)}…\n`);
  check(modelView.includes('"is_counter":false'), 'grain in the model view');
  check(modelView.includes(`"measured_at":"${backupExport.exportedAt}"`), 'the export time as measured_at');
  check(modelView.includes('Cohesity API'), 'provenance in the model view');
  check(modelView.includes('PPDM — not collected on this install'), 'not_covered composed from coverage');
  check(!modelView.includes('af_semantics'), 'no marker in the model view');
  check(!modelView.includes('render'), 'no render hints in the model view');

  const env = recorded[0]?.semantics as Record<string, unknown> | undefined;
  console.log('   What the RECORD kept (tools.semantics_declared — the full envelope):');
  console.log(`   grain=${JSON.stringify(env?.grain)}  provenance.source=${String((env?.provenance as Record<string, unknown>)?.source)}`);
  console.log(`   render=${JSON.stringify(env?.render)}  ← the UI hint the model never saw\n`);
  check(recorded.length === 1, 'one semantics_declared event');
  check(env?.af_semantics === true, 'the full envelope on the record');

  // ── 2. The coverage absorb ─────────────────────────────────────────────
  console.log('2. The envelope\'s coverage flowed through the coverage() channel —');
  console.log('   .limitsTravelWithTheAnswer() appended it to the final answer:\n');
  check(answer.includes('Coverage of this answer'), 'the limits block on the answer');
  check(answer.includes('PPDM'), 'the blind spot named in the answer');
  check(!answer.includes('Cohesity API'), 'provenance never reaches the answer');
  console.log(`   ${answer.split('\n').slice(-4).join('\n   ')}\n`);

  // ── 3. One execute, three helpers ──────────────────────────────────────
  console.log('3. One execute, three helpers — what the model read for each:\n');
  const views = await modelViews();
  console.log(`   describedResult → ${views.described.slice(0, 110)}…`);
  console.log(`   coverage        → ${views.covered.slice(0, 110)}…`);
  console.log(`   absent          → ${views.absent.slice(0, 110)}…\n`);
  check(views.described.startsWith('{"facts":'), 'describedResult: the rows, first');
  check(!views.described.includes('"checked"'), 'describedResult: the checked list stays on the record');
  check(views.covered.startsWith('{"af_coverage":'), 'coverage: the ledger first, the value under result');
  check(views.absent.startsWith('{"af_absent":true'), 'absent: an answer, not an error');

  // ── 4. The gate ────────────────────────────────────────────────────────
  console.log('4. check:semantics — the honest tool passes, the broken one fails BY NAME:\n');
  const catalog = [
    { name: backupStatus.schema.name, resultClass: backupStatus.resultClass, results: [backupStatus.execute({ vm: 'vm-01' }, {} as never)] },
    { name: brokenTriage.schema.name, resultClass: brokenTriage.resultClass, results: [brokenTriage.execute({}, {} as never)] },
  ];
  const report = checkSemantics(catalog as never);
  console.log(`   ${formatSemanticsReport(report).split('\n').join('\n   ')}\n`);
  check(!report.ok, 'the gate fails');
  const failing = report.findings.find((f) => f.severity === 'error');
  check(failing?.tool === 'nas_share_triage', 'the failure names the tool');
  check(failing?.field === 'coverage', 'the failure names the field');
  check(failing?.message.includes('describedResult(') === true, 'the advice names describedResult()');
  check(
    report.findings.every((f) => f.tool !== 'vm_backup_status'),
    'the honest tool has zero findings',
  );
  console.log('   In CI this is one line beside check:tools:');
  console.log('   "check:semantics": "agentfootprint-check-semantics semantics-catalog.json"\n');

  // ── 5. An empty list names the door for "nothing matched" ─────────────
  // A data list is never empty — "nothing matched" has ONE helper — so a tool
  // without an empty branch meets this on its first empty read, where the
  // model reads the refusal in place of the data. It says which branch to write.
  console.log('5. An empty list is refused — and the refusal names the branch to write:\n');
  let refusal = '';
  try {
    describedResult({
      facts: [],
      provenance: { measuredAt: backupExport.exportedAt, source: backupExport.source },
    });
  } catch (err) {
    refusal = (err as Error).message;
  }
  console.log(`   ${refusal}`);
  check(
    refusal.startsWith('refused: `facts` is empty — if nothing matched, return absent({ what, checked }) instead.'),
    'the empty-data refusal to name absent()',
  );

  return answer.split('\n')[0] ?? answer;
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
