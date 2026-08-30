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
 *   - `walk: { recording: true }` — ALSO file the inner chart's own
 *     `{ snapshot, events, structure }` under `recording/run`, so a viewer
 *     can draw the walk as the flowchart it ran. Opt-in: the walk is a row
 *     projection carrying sentences, a recording carries whatever the chart
 *     WROTE. The ref rides the same descriptor as `walk.recording_ref`, and
 *     every absence (no store, over `maxBytes`, a failed mint) is STATED in
 *     `walk.recording_note` rather than left as a missing field;
 *   - the OPTIONAL verdict projection — selected by `resultKind:
 *     'verdict/*'`: rows off the chart's `verdicts` state key, truthful
 *     counters, ONE cap for the list and the table, and `verdict_meanings`
 *     GENERATED from the decider's declared branches + rule labels;
 *   - `presentation` — WHO renders those rows. The same procedure is
 *     registered twice here, one dial apart: 'prose' (default) ships the
 *     pre-rendered table because the model's words are the rows' only
 *     surface; 'panel' ships NO table, because the host already drew them
 *     and retyping is pure transcription risk.
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
// #region rules
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
// #endregion rules

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
  // #region subject-chart
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
  // #endregion subject-chart

  // The runbook: inventory → bounded fan-out (one decider pass per subject,
  // each an isolated branch) → collect rows + declare the chart's own limits.
  const declaration = {
    description: 'Assess backup protection posture for every subject in the estate.',
    resultKind: 'verdict/backup-posture',
    rules: { name: 'health-signal', version: 'v1' },
    verdicts: { decider: 'Protection posture' },
    composedOf: ['backup_inventory'],
    // OPT-IN (9.79.0): also file the inner chart's own recording, so this
    // walk can be DRAWN. The walk artifact is a ROW projection — a step
    // graph cannot be inferred from sentences about steps — and `structure`
    // is the only route to a drawable graph. Off by default because a
    // recording carries whatever the chart WROTE; declared here, its ref
    // rides the same descriptor as `walk.recording_ref`.
    walk: { recording: true },
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
        // #region fan-out
        .addParallelForEach<Subject>('Assess each subject', 'per-subject', {
          items: (scope: Record<string, unknown>) => (scope.subjects as Subject[]) ?? [],
          branch: (item, index) => subjectChart(item, index),
          maxBranches: 50,
          into: 'subject_results',
        })
        // #endregion fan-out
        // #region collect
        .addFunction(
          'Collect',
          (scope: Record<string, unknown>) => {
            // A branch that FAILED keeps its slot with an `undefined` value, so
            // this array's length is always the branch count. Dropping the
            // blanks is fine; losing the COUNT is not — the two numbers are
            // kept and allowed to disagree.
            const slots = (scope.subject_results as ({ row?: unknown } | undefined)[]) ?? [];
            const rows = slots.map((slot) => slot?.row).filter((row) => row !== undefined);
            const subjectsTotal = (scope.subjects as Subject[]).length;
            scope.verdicts = rows;
            if (rows.length < subjectsTotal) {
              // RESERVED key — the chart's own limits, folded into the answer's
              // ledger by the bridge. A gap nobody reported is a confident
              // partial answer, which is the one thing this envelope refuses.
              scope.coverage = {
                not_checked: [
                  {
                    what: `${
                      subjectsTotal - rows.length
                    } of ${subjectsTotal} subject(s), which reached no verdict`,
                    why: 'their branch failed, and a failed branch keeps its slot rather than its answer',
                  },
                ],
              };
            }
            scope.report = {
              stale_after_days: STALE_AFTER_DAYS,
              subjects_total: subjectsTotal,
              subjects_assessed: rows.length,
            };
          },
          'collect',
        )
        // #endregion collect
        .build(),
  } as const;

  // THE SAME PROCEDURE, ONE DIAL APART. `presentation` names who renders the
  // rowset — the one thing about its client a runbook cannot work out for
  // itself. Default 'prose': the model's words are the rows' only surface, so
  // the table ships pre-rendered and is output verbatim. 'panel': the host
  // draws the rowset beside the answer, so NO table ships and the note says
  // not to retype rows the reader is already looking at.
  const triage = runbookAsTool({ name: 'backup_triage', ...declaration });
  const triageForPanel = runbookAsTool({
    name: 'backup_triage_panel',
    ...declaration,
    presentation: 'panel',
  });

  // Scripted: turn 1 runs the procedure for a chat client, turn 2 for a
  // panel client, turn 3 answers from the envelopes.
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
        if (turn === 2) {
          return {
            content: 'Running it again for the panel client.',
            toolCalls: [{ id: 'c2', name: 'backup_triage_panel', args: {} }],
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
    .tool(triageForPanel)
    .build();

  let envelope: RunbookEnvelope | undefined;
  let panelEnvelope: RunbookEnvelope | undefined;
  agent.on('agentfootprint.stream.tool_end', (event) => {
    if (event.payload.toolCallId === 'c1') {
      envelope = event.payload.result as unknown as RunbookEnvelope;
    }
    if (event.payload.toolCallId === 'c2') {
      panelEnvelope = event.payload.result as unknown as RunbookEnvelope;
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
    // The dial's whole visible effect: same rows, different surface.
    prose_surface: {
      ships_table: envelope !== undefined && 'table' in envelope.result,
      render_note: envelope?.result.render_note,
    },
    panel_surface: {
      ships_table: panelEnvelope !== undefined && 'table' in panelEnvelope.result,
      render_note: panelEnvelope?.result.render_note,
      rows_are_the_same:
        JSON.stringify(panelEnvelope?.result.verdicts) ===
        JSON.stringify(envelope?.result.verdicts),
    },
  };
}

if (isCliEntry(import.meta.url)) {
  run(meta.defaultInput ?? '')
    .then(printResult)
    .catch(console.error);
}
