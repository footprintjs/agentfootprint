/**
 * 68 — runbookAsTool: turn a written procedure into a tool whose every
 * answer is EVIDENCE.
 *
 * WHY: the most-used agent job in a business is triage — run the standing
 * procedure, come back with a verdict somebody can act on. A hand-rolled
 * triage tool ends up rebuilding the same envelope every time: a coverage
 * ledger, a rule-version stamp, capped verdict rows with a rendered table,
 * and the recorded walk that lets a reader CHECK the verdict instead of
 * trusting it. `runbookAsTool` is that envelope as one declaration bag:
 *
 *   - `procedure` — a factory invoked per call with the run's own tool
 *     dispatch (`ctx.tools`): stages call REGISTERED tools, and every inner
 *     tool's honesty ledger folds into this tool's answer;
 *   - the MANDATORY SPINE — coverage + sentence, provenance re-emitted
 *     first, `rule_version`, and the walk descriptor (the walk itself is an
 *     artifact ticket, kind `recording/chart-walk`);
 *   - the OPTIONAL verdict projection — selected by `resultKind:
 *     'verdict/*'`: rows off the chart's `verdicts` state key, truthful
 *     counters, ONE cap for the list and the table, and `verdict_meanings`
 *     GENERATED from the decider's declared branches + rule labels.
 *
 * Run:  npx tsx examples/features/68-runbook-as-tool.ts
 */

import { decide, flowChart, type DecideRule } from 'footprintjs';
import {
  Agent,
  coverage,
  defineTool,
  inMemoryArtifacts,
  runbookAsTool,
  type LLMProvider,
  type RunbookEnvelope,
  type ToolDispatch,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/68-runbook-as-tool',
  title: 'runbookAsTool — procedures as tools, answers as evidence',
  group: 'features',
  description:
    'Declare a triage procedure once (rules, decider, inner tools) and get back the honesty ' +
    'envelope: coverage folded from inner tools, rule provenance, generated verdict meanings, ' +
    'and the recorded walk as a recording/chart-walk artifact ticket.',
  defaultInput: 'triage the backup estate',
  providerSlots: ['default'],
  tags: ['feature', 'runbook', 'tools', 'evidence', 'artifacts'],
};

// ── The rules: one home, versioned, filter rules so the evidence carries
//    {key, op, threshold, actual} — a function rule would leave no 7 behind.
const STALE_AFTER_DAYS = 7;
const POSTURE_RULES: DecideRule<Record<string, unknown>>[] = [
  {
    when: { age_known: { eq: false } },
    then: 'declined',
    label: 'the age signal is unreadable — no classification',
  },
  {
    when: { age_days: { gt: STALE_AFTER_DAYS } },
    then: 'unprotected',
    label: `last backup older than the ${STALE_AFTER_DAYS}-day threshold`,
  },
];

interface Subject {
  readonly subject: string;
  readonly lastBackupDays: number | null;
}

export async function run(input: string, provider?: LLMProvider): Promise<unknown> {
  // The INNER tool — a registered source the procedure calls through the
  // run's own dispatch. Its coverage ledger folds into the runbook's answer.
  const inventory = defineTool({
    name: 'backup_inventory',
    description: 'List backup subjects with their last-backup age.',
    execute: () =>
      coverage(
        {
          rows: [
            { subject: 'cluster-a', lastBackupDays: 2 },
            { subject: 'cluster-b', lastBackupDays: 30 },
            { subject: 'cluster-c', lastBackupDays: null },
          ] satisfies Subject[],
        },
        {
          checked: ['the backup inventory, one row per job'],
          cannotCover: [
            { what: 'WHY a protection was paused', why: 'no change record is collected here' },
          ],
        },
      ),
  });

  // ONE subject's chart: seed the facts, decide, land the verdict row.
  const subjectChart = (subject: Subject, index: number) => {
    const land = (verdict: string) => (s: Record<string, unknown>) => {
      s.row = { subject: subject.subject, verdict, age: subject.lastBackupDays };
    };
    return flowChart<Record<string, unknown>>(
      `Read ${subject.subject}`,
      (s) => {
        s.age_known = subject.lastBackupDays !== null;
        s.age_days = subject.lastBackupDays ?? -1;
      },
      `subject-${index}`,
    )
      .addDeciderFunction(
        'Protection posture',
        (s: Record<string, unknown>) => decide(s, POSTURE_RULES, 'protected'),
        'posture',
        'Three declared outcomes, first match wins; anything unmatched is protected.',
      )
      .addFunctionBranch('declined', 'Declined — signal unreadable', land('declined'))
      .addFunctionBranch('unprotected', 'Unprotected — stale backup', land('unprotected'))
      .addFunctionBranch('protected', 'Protected — inside threshold', land('protected'))
      .end()
      .build();
  };

  // The runbook: inventory → bounded fan-out (one decider pass per subject,
  // each an isolated branch) → collect rows + declare the chart's own limits.
  const triage = runbookAsTool({
    name: 'backup_triage',
    description: 'Assess backup protection posture for every subject in the estate.',
    resultKind: 'verdict/backup-posture',
    rules: { name: 'health-signal', version: 'v1' },
    verdicts: { decider: 'Protection posture' },
    composedOf: ['backup_inventory'],
    procedure: (tools: ToolDispatch) =>
      flowChart<Record<string, unknown>>(
        'backup-protection-triage',
        async (scope) => {
          const inner = (await tools.call('backup_inventory', {})) as {
            result: { rows: Subject[] };
          };
          scope.subjects = inner.result.rows;
        },
        'inventory',
      )
        .addParallelForEach<Subject>('Assess each subject', 'per-subject', {
          items: (scope: Record<string, unknown>) => (scope.subjects as Subject[]) ?? [],
          branch: (item, index) => subjectChart(item, index),
          maxBranches: 50,
          into: 'subject_results',
        })
        .addFunction(
          'Collect',
          (scope: Record<string, unknown>) => {
            const results = (scope.subject_results as { row?: unknown }[]) ?? [];
            scope.verdicts = results.map((r) => r?.row).filter((row) => row !== undefined);
            scope.report = {
              stale_after_days: STALE_AFTER_DAYS,
              subjects_total: (scope.subjects as Subject[]).length,
            };
          },
          'collect',
        )
        .build(),
  });

  // Scripted: turn 1 calls the runbook; turn 2 answers from its envelope.
  let turn = 0;
  const scripted =
    provider ??
    mock({
      respond: () => {
        turn += 1;
        if (turn === 1) {
          return {
            content: 'Running the triage procedure.',
            toolCalls: [{ id: 'c1', name: 'backup_triage', args: {} }],
            stopReason: 'tool_use',
          };
        }
        return {
          content: 'Triage done — one stale backup, one unreadable signal. See the walk.',
          toolCalls: [],
          stopReason: 'stop',
        };
      },
    });

  const artifacts = inMemoryArtifacts();
  const agent = Agent.create({ provider: scripted, model: 'mock', maxIterations: 5, artifacts })
    .system('You run standing procedures and answer with their evidence.')
    .tool(inventory)
    .tool(triage) // composedOf drift-checked HERE — the catalog is complete
    .build();

  let envelope: RunbookEnvelope | undefined;
  agent.on('agentfootprint.stream.tool_end', (event) => {
    if (event.payload.toolCallId === 'c1') {
      envelope = event.payload.result as unknown as RunbookEnvelope;
    }
  });

  const answer = await agent.run({ message: input });

  return {
    answer,
    coverage_sentence: envelope?.af_coverage.sentence,
    rule_version: envelope?.result.rule_version,
    verdicts: envelope?.result.verdicts,
    verdict_meanings: envelope?.result.verdict_meanings,
    walk: envelope?.result.walk,
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
