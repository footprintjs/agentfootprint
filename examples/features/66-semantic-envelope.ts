/**
 * 66 — the semantic tool-result envelope + check:semantics (9.53.0).
 *
 * The ask came from a triage-platform team with seventy tools: every honest
 * tool re-implemented the same caveats by hand — the collection interval,
 * whether the values are counters that must never be summed, when the world
 * was actually measured, which clusters were NOT collected — and review was
 * the only thing keeping them there. Culture scales to one disciplined
 * author. It does not scale to a hundred tools.
 *
 * `semantic({...})` makes those caveats TYPED DATA that travel with the
 * values, and `check:semantics` is the build gate that refuses a tool that
 * forgot them — by tool name and field name.
 *
 * Three things this example shows, in order:
 *
 *   1. Two views of one envelope — the MODEL reads a compact rendering-free
 *      projection (data + grain + provenance + `not_covered`); the RECORD
 *      gets the full envelope on `agentfootprint.tools.semantics_declared`,
 *      render hints, coverage detail and all.
 *   2. The coverage absorb — the envelope's `coverage` field flows through
 *      the same channel `coverage()` uses, so `.limitsTravelWithTheAnswer()`
 *      appends it to the final answer with zero extra wiring.
 *   3. The gate — `checkSemantics` passes the honest tool, then fails a
 *      deliberately broken triage tool BY NAME, naming the missing field.
 *
 * Run:  npm run example examples/features/66-semantic-envelope.ts
 */

import { Agent, defineTool, semantic, type LLMProvider } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { checkSemantics, formatSemanticsReport } from '../../src/doors/observe.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/66-semantic-envelope',
  title: 'Semantic tool results — caveats that travel with the numbers, and a gate that enforces them',
  group: 'features',
  description:
    'A triage tool returns semantic({ series, grain, provenance, coverage }): the model reads a ' +
    'compact projection, the record keeps the full envelope, and check:semantics fails a triage ' +
    'tool that forgot its coverage — naming the tool and the field.',
  defaultInput: 'Is the backup posture for shiecgprnap103 healthy?',
  providerSlots: ['default'],
  tags: ['features', 'tools', 'observability', 'governance'],
};

function check(claim: boolean, what: string): void {
  if (!claim) throw new Error(`expected ${what}`);
}

/** The honest triage tool: a verdict WITH its boundary, as data. */
const backupStatus = defineTool({
  name: 'vm_backup_status',
  description: 'Backup posture for one VM across the Cohesity clusters',
  resultClass: 'triage',
  inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
  execute: ({ vm }: { vm: string }) =>
    semantic({
      facts: [{ entity: vm, backed_up: true, copies: 1, last_success_hours_ago: 16.1 }],
      series: [
        { t: '2026-08-18T18:00:00Z', entity: vm, metric: 'backup_runs_ok', value: 1 },
        { t: '2026-08-19T10:00:00Z', entity: vm, metric: 'backup_runs_ok', value: 1 },
      ],
      grain: { interval: 'daily', aggregation: 'count', is_counter: true },
      provenance: {
        measured_at: '2026-08-19T10:12:00Z',
        age_seconds: 480,
        source: 'Cohesity API (4 clusters)',
      },
      coverage: {
        checked: ['4 Cohesity clusters'],
        cannotCover: [{ what: 'PPDM', why: 'not collected on this install' }],
      },
      render: { default: 'table', columns: ['entity', 'backed_up', 'copies'], sort: 'entity' },
    }),
});

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
      { toolCalls: [{ id: 'call-backup-1', name: 'vm_backup_status', args: { vm: 'shiecgprnap103' } }] },
      { content: 'Backed up — last successful run 16.1h ago. Note: PPDM is not collected here.' },
    ],
  });

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

  const history = (agent.getLastSnapshot()?.sharedState as { history: Array<{ role: string; content: unknown }> }).history;
  const toolTurn = history.find((m) => m.role === 'tool');
  const modelView = typeof toolTurn?.content === 'string' ? toolTurn.content : JSON.stringify(toolTurn?.content);

  console.log('1. What the MODEL read (the compact projection — caveats travel with the numbers):\n');
  console.log(`   ${modelView.slice(0, 220)}…\n`);
  check(modelView.includes('"is_counter":true'), 'grain in the model view');
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
  console.log(`   ${answer.split('\n').slice(-4).join('\n   ')}\n`);

  // ── 3. The gate ────────────────────────────────────────────────────────
  console.log('3. check:semantics — the honest tool passes, the broken one fails BY NAME:\n');
  const catalog = [
    { name: backupStatus.schema.name, resultClass: backupStatus.resultClass, results: [backupStatus.execute({ vm: 'shiecgprnap103' }, {} as never)] },
    { name: brokenTriage.schema.name, resultClass: brokenTriage.resultClass, results: [brokenTriage.execute({}, {} as never)] },
  ];
  const report = checkSemantics(catalog as never);
  console.log(`   ${formatSemanticsReport(report).split('\n').join('\n   ')}\n`);
  check(!report.ok, 'the gate fails');
  const failing = report.findings.find((f) => f.severity === 'error');
  check(failing?.tool === 'nas_share_triage', 'the failure names the tool');
  check(failing?.field === 'coverage', 'the failure names the field');
  check(
    report.findings.every((f) => f.tool !== 'vm_backup_status'),
    'the honest tool has zero findings',
  );
  console.log('   In CI this is one line beside check:tools:');
  console.log('   "check:semantics": "agentfootprint-check-semantics semantics-catalog.json"');

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
