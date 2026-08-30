/**
 * runbookAsTool — turn a written operational procedure into a tool whose
 * every answer is EVIDENCE: who decided what, against which threshold, on
 * which rule version, with the recorded walk to check it against.
 *
 * The standard bridge from a footprintjs chart to the Agent's tool surface.
 * Where `flowchartAsTool` returns bare `JSON.stringify(values)`,
 * runbookAsTool supplies the missing middle — the honesty envelope every
 * hand-rolled triage tool was building for itself:
 *
 *   THE MANDATORY SPINE (every runbook, whatever its shape):
 *     - `af_coverage` — the three-list ledger, with every INNER tool's own
 *       ledger folded upward through the run's dispatch, plus the sentence
 *       naming the rule set and version;
 *     - `result.af_provenance` — re-emitted FIRST (a carried `LOCAL SEED`
 *       confession survives composition);
 *     - `result.rule_version` — the declared rules' version, or the honest
 *       `'undeclared'`;
 *     - `result.walk` — the recorded walk's descriptor. The walk itself
 *       ships as an artifact ticket (kind `recording/chart-walk`), never as
 *       bytes; when it does not fit, the CONTROL FLOW survives and the
 *       projection is declared. Opt into `walk: { recording: true }` and the
 *       inner chart's own `{ snapshot, events, structure }` is filed beside
 *       it (kind `recording/run`) and its ref rides the SAME descriptor as
 *       `walk.recording_ref` — the row projection cannot be drawn, and this
 *       is what makes the walk mountable as the flowchart it ran.
 *
 *   THE OPTIONAL PROJECTION (selected by `resultKind: 'verdict/*'`):
 *     verdict rows off the chart's `verdicts` state key, capped with
 *     truthful counters, a pre-rendered table over the SAME rows, and
 *     `verdict_meanings` GENERATED from the decider's declared branches +
 *     the rule labels this run's decide() evidence carried.
 *
 *   WHO RENDERS THE ROWSET (`presentation`, default `'prose'`): the bridge
 *     cannot see which client it is in, so the caller says. Under `'prose'`
 *     the model's words are the rowset's only surface — the table ships
 *     pre-rendered and is output verbatim. Under `'panel'` the host draws
 *     the rowset itself — no table ships, and the note says not to
 *     reproduce rows the reader is already looking at.
 *
 *   THREE OUTCOMES, honestly: a clean envelope; an inner ABSENCE passed
 *   through verbatim (the framework still reads it as an absence); and
 *   DECLINED rows counted into the ledger as not-checked ground.
 *
 * The procedure is a FACTORY invoked per call with the run's own tool
 * dispatch (`ctx.tools`) — fresh chart every run, stages close over the
 * dispatch, and every inner tool's honesty ledger folds into this tool's
 * answer.
 *
 * Reserved state keys the bridge reads off the final scope:
 *   - `verdicts` — the rowset (verdict projection only);
 *   - `coverage` — chart-declared coverage entries (`{checked?, not_checked?,
 *     cannot_cover?}`);
 *   - `report`  — the app's own result fields, spread into `result` verbatim
 *     BESIDE the spine, never over it: the envelope's own names (the spine
 *     plus the projection this run assembled) are reserved, and a report
 *     field spelling one of them is discarded and NAMED in `report_note`.
 *
 * Pause: NOT yet bridged. A paused inner chart throws with the checkpoint
 * attached, exactly like `flowchartAsTool` — the approval-gate integration
 * is the next phase of the runbook program.
 *
 * @example the smallest legal call — still yields the honest spine
 *   const tool = runbookAsTool({
 *     name: 'restart_check',
 *     description: 'Run the restart-safety procedure.',
 *     procedure: () =>
 *       flowChart<{ safe: boolean }>('restart-safety', (scope) => {
 *         scope.safe = true;
 *       }, 'check').build(),
 *   });
 *
 * @example a triage runbook with rules, verdicts, and an inner tool
 *   const triage = runbookAsTool({
 *     name: 'backup_triage',
 *     description: 'Assess backup protection posture for every subject.',
 *     resultKind: 'verdict/backup-posture',
 *     rules: { name: 'health-signal', version: 'v1' },
 *     verdicts: { decider: 'posture' },
 *     composedOf: ['backup_inventory'],
 *     procedure: (tools) =>
 *       flowChart<TriageState>('backup-triage', async (scope) => {
 *         const inner = (await tools.call('backup_inventory', {})) as InventoryResult;
 *         scope.subjects = inner.result.rows;
 *       }, 'inventory')
 *         .addDeciderFunction('Posture', postureDecider, 'posture')
 *           .addFunctionBranch('protected', 'Protected', landProtected)
 *           .addFunctionBranch('unprotected', 'Unprotected', landUnprotected)
 *           .end()
 *         .build(),
 *   });
 */

import { FlowChartExecutor, narrative, type CombinedRecorder } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import {
  DEFAULT_INNER_RUN_LIMIT,
  INNER_RUN_RECORDS,
  innerRunStore,
  type InnerRunOutcome,
  type InnerRunStore,
  type KeepsInnerRuns,
} from '../../lib/trace-toolpack/innerRunRecords.js';
import { defineTool, type Tool, type ToolExecutionContext } from '../tools.js';
import {
  carriedProvenanceOf,
  chartCoverageOf,
  composeLedger,
  foldInnerCoverage,
} from './coverage.js';
import { absenceSignalOf, probeDispatch, recordingDispatch } from './dispatch.js';
import { chartRecordingOf, mintChartRecording, resolveRecordingPolicy } from './recording.js';
import { admitReport, REPORT_NOTE_KEY, shadowedFieldsNote } from './report.js';
import type {
  RunbookAsToolOptions,
  RunbookEnvelope,
  RunbookPresentation,
  VerdictRow,
} from './types.js';
import {
  composeMeanings,
  DECLINED_VERDICT,
  DEFAULT_MAX_ROWS,
  meaningsRecorder,
  PANEL_RENDER_NOTE,
  renderVerdictTable,
  resolveDecider,
  VERDICT_RENDER_NOTE,
  verdictRowsOf,
} from './verdicts.js';
import { DEFAULT_WALK_CAP, mintWalk, projectWalk, type NarrativeEntryView } from './walk.js';

/** The projection selector: a `resultKind` in the `verdict/` namespace gets
 *  the rowset projection; every other kind ships the spine plus the chart's
 *  own `report`. */
const VERDICT_KIND_PREFIX = 'verdict/';

/** The presentations, as the dial spells them. */
const PRESENTATIONS: readonly RunbookPresentation[] = ['prose', 'panel'];

/**
 * The projection's RESERVED VOCABULARY: the keys this run assembled, plus
 * `table` — which `presentation: 'panel'` deliberately omits so that no table
 * reaches the model at all. A `report` field spelling the freed name would put
 * one straight back, so the mode's promise outranks the vacancy.
 */
function reservedProjectionNames(projection: Record<string, unknown> | undefined): string[] {
  return projection === undefined ? [] : [...Object.keys(projection), 'table'];
}

function bagOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Lift the chart's declared input schema when it is a PLAIN JSON-Schema
 *  object. A parseable schema (`.safeParse`/`.parse` — zod et al.) validates
 *  at the executor but cannot be serialized for the model: skipped, default
 *  applies. */
function liftInputSchema(chart: {
  inputSchema?: unknown;
}): Readonly<Record<string, unknown>> | undefined {
  const schema = bagOf(chart.inputSchema);
  if (schema === undefined) return undefined;
  const parseable =
    typeof (schema as { safeParse?: unknown }).safeParse === 'function' ||
    typeof (schema as { parse?: unknown }).parse === 'function';
  return parseable ? undefined : (schema as Readonly<Record<string, unknown>>);
}

/**
 * Wrap a footprintjs procedure as a `Tool` whose every answer carries the
 * honesty spine. See the module header for the envelope; see
 * {@link RunbookAsToolOptions} for the full options bag. The smallest legal
 * call is `{ name, description, procedure }`.
 */
export function runbookAsTool(opts: RunbookAsToolOptions): Tool {
  const label = `runbookAsTool(${opts.name || '?'})`;
  if (!opts.name || opts.name.trim().length === 0) {
    throw new Error('runbookAsTool: `name` is required and must be non-empty.');
  }
  if (!opts.description || opts.description.length === 0) {
    throw new Error(
      `${label}: \`description\` is required — a description-less tool is invisible to the model.`,
    );
  }
  if (typeof opts.procedure !== 'function') {
    throw new Error(
      `${label}: \`procedure\` is required — a factory invoked per call with the run's ` +
        `tool dispatch, returning a built chart. (Migrating from flowchartAsTool? Wrap ` +
        `your chart: \`procedure: () => chart\` builds it fresh each run.)`,
    );
  }
  if (opts.rules !== undefined) {
    const { name, version } = opts.rules;
    if (
      typeof name !== 'string' ||
      name.trim() === '' ||
      typeof version !== 'string' ||
      version.trim() === ''
    ) {
      throw new Error(
        `${label}: \`rules\` must carry a non-empty name and version — it is the provenance ` +
          `stamp every evidence sentence names. Got ${JSON.stringify(opts.rules)}.`,
      );
    }
  }
  if (opts.verdicts !== undefined) {
    if (typeof opts.verdicts.decider !== 'string' || opts.verdicts.decider.trim() === '') {
      throw new Error(
        `${label}: \`verdicts.decider\` must name the decider stage whose branches generate ` +
          `verdict_meanings. Got ${JSON.stringify(opts.verdicts.decider)}.`,
      );
    }
    const maxRows = opts.verdicts.maxRows;
    if (maxRows !== undefined && (!Number.isInteger(maxRows) || maxRows < 1)) {
      throw new Error(
        `${label}: \`verdicts.maxRows\` must be a whole number of rows, at least 1 — got ` +
          `${String(maxRows)}.`,
      );
    }
  }
  if (opts.presentation !== undefined && !PRESENTATIONS.includes(opts.presentation)) {
    throw new Error(
      `${label}: \`presentation\` names WHO renders the rowset — 'prose' (the default: the ` +
        `model's prose is the rowset's only surface, so the pre-rendered table ships and is ` +
        `output verbatim) or 'panel' (the host draws the rowset, so no table ships). Got ` +
        `${JSON.stringify(opts.presentation)}.`,
    );
  }
  const cap = opts.walk?.cap;
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1)) {
    throw new Error(
      `${label}: \`walk.cap\` must be a whole number of rows, at least 1 — got ${String(cap)}.`,
    );
  }
  const recordingOpt = opts.walk?.recording;
  if (
    recordingOpt !== undefined &&
    typeof recordingOpt !== 'boolean' &&
    (recordingOpt === null || typeof recordingOpt !== 'object' || Array.isArray(recordingOpt))
  ) {
    throw new Error(
      `${label}: \`walk.recording\` must be \`true\` (file the inner chart's recording with ` +
        `the defaults), \`false\`/absent (do not file one), or an options bag ` +
        `\`{ label?, maxBytes? }\` — got ${JSON.stringify(recordingOpt)}.`,
    );
  }
  if (typeof recordingOpt === 'object' && recordingOpt !== null) {
    const maxBytes = recordingOpt.maxBytes;
    if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) {
      throw new Error(
        `${label}: \`walk.recording.maxBytes\` must be a whole number of bytes, at least 1 — ` +
          `got ${String(maxBytes)}. It is the declared ceiling a recording is REFUSED over, ` +
          `never truncated to.`,
      );
    }
  }
  if (opts.keepRecordLimit !== undefined) {
    if (opts.keepRecord !== true) {
      throw new Error(
        `${label}: \`keepRecordLimit\` caps records that are never kept — add ` +
          `\`keepRecord: true\`, or drop the limit.`,
      );
    }
    if (!Number.isInteger(opts.keepRecordLimit) || opts.keepRecordLimit < 1) {
      throw new Error(
        `${label}: \`keepRecordLimit\` must be a whole number of invocations, at least 1 — ` +
          `got ${String(opts.keepRecordLimit)}.`,
      );
    }
  }

  // ── Definition-time probe: read the chart's declared contract ─────────
  let probeChart: ReturnType<typeof opts.procedure>;
  try {
    probeChart = opts.procedure(probeDispatch(opts.name));
  } catch (err) {
    throw new Error(
      `${label}: the procedure factory threw at the definition probe — ` +
        `${err instanceof Error ? err.message : String(err)}. The factory is invoked once ` +
        `at definition (stage bodies do not run) to read the chart's declared contract; ` +
        `it must be side-effect-free at build.`,
    );
  }
  if (
    probeChart === null ||
    typeof probeChart !== 'object' ||
    typeof (probeChart as { stageMap?: unknown }).stageMap !== 'object'
  ) {
    throw new Error(
      `${label}: \`procedure\` must return a BUILT chart (call .build() on the builder).`,
    );
  }

  const inputSchema = opts.inputSchema ?? liftInputSchema(probeChart);
  const isVerdictKind = opts.resultKind?.startsWith(VERDICT_KIND_PREFIX) === true;
  const rendersItsOwnRows = opts.presentation === 'panel';
  const maxRows = opts.verdicts?.maxRows ?? DEFAULT_MAX_ROWS;
  const walkCap = opts.walk?.cap ?? DEFAULT_WALK_CAP;
  // Resolved ONCE at definition. `undefined` is the whole off-switch: every
  // line the recording feature adds sits behind this being defined, so an
  // undeclared runbook takes no second snapshot, measures no bytes, and makes
  // no store call — its envelope is byte-identical to 9.78.0.
  const recordingPolicy = resolveRecordingPolicy(recordingOpt);

  const store: InnerRunStore | undefined =
    opts.keepRecord === true
      ? innerRunStore(opts.keepRecordLimit ?? DEFAULT_INNER_RUN_LIMIT)
      : undefined;

  const tool = defineTool<Record<string, unknown>, unknown>({
    name: opts.name,
    description: opts.description,
    ...(inputSchema !== undefined && { inputSchema }),
    // GAP-8 closed: the rail-read declarations forward verbatim.
    ...(opts.resultKind !== undefined && { resultKind: opts.resultKind }),
    ...(opts.resultClass !== undefined && { resultClass: opts.resultClass }),
    ...(opts.owner !== undefined && { owner: opts.owner }),
    ...(opts.resultCeiling !== undefined && { resultCeiling: opts.resultCeiling }),
    ...(opts.wants !== undefined && { wants: opts.wants }),
    ...(opts.argumentsFrom !== undefined && { argumentsFrom: opts.argumentsFrom }),
    ...(opts.composedOf !== undefined && { composedOf: opts.composedOf }),
    execute: async (args, ctx: ToolExecutionContext) => {
      const dispatch = recordingDispatch(ctx.tools, opts.name);
      const chart = opts.procedure(dispatch.tools);
      const executor = new FlowChartExecutor(chart);
      if (opts.redact) executor.setRedactionPolicy(opts.redact);
      for (const recorder of opts.recorders ?? []) {
        executor.attachCombinedRecorder(recorder);
      }
      // Values off: the walk is about the DECISIONS — a per-key value dump
      // would bury six branch choices under four hundred reads.
      const walkRecorder = narrative({ includeValues: false });
      executor.attachCombinedRecorder(walkRecorder as unknown as CombinedRecorder);
      // Meanings harvest — resolve the decider on THIS run's chart (a fresh
      // chart per call; the static branches are the same, the resolution is
      // cheap) and collect rule labels as the evidence fires.
      const identity =
        opts.verdicts !== undefined ? resolveDecider(chart, opts.verdicts.decider) : undefined;
      const harvest = identity !== undefined ? meaningsRecorder(identity) : undefined;
      if (harvest !== undefined) executor.attachCombinedRecorder(harvest.recorder);
      const ctrl = store ? controlDepRecorder() : undefined;
      if (ctrl) executor.attachCombinedRecorder(ctrl as unknown as CombinedRecorder);

      const keepRecordOf = (outcome: InnerRunOutcome, known?: unknown): void => {
        if (!store) return;
        try {
          const snapshot = known ?? executor.getSnapshot();
          const commitLog = (snapshot as { commitLog?: readonly unknown[] }).commitLog;
          const lines = (walkRecorder.getEntries() as unknown as NarrativeEntryView[])
            .map((entry) => entry.text)
            .filter((text) => typeof text === 'string' && text.length > 0);
          store.keep({
            toolCallId: ctx.toolCallId,
            toolName: opts.name,
            outcome,
            steps: Array.isArray(commitLog) ? commitLog.length : 0,
            recording: {
              snapshot,
              structure: (chart as { buildTimeStructure?: unknown }).buildTimeStructure,
            },
            ...(ctrl !== undefined && { controlDeps: ctrl.asLookup() }),
            ...(lines.length > 0 && { narrative: lines }),
          });
        } catch (e) {
          store.keep({
            toolCallId: ctx.toolCallId,
            toolName: opts.name,
            outcome,
            steps: 0,
            problem: e instanceof Error ? e.message : String(e),
          });
        }
      };

      const env: { signal?: AbortSignal } = {};
      if (ctx.signal) env.signal = ctx.signal;
      try {
        await executor.run({ input: args, env });
      } catch (e) {
        const signal = absenceSignalOf(e);
        if (signal !== undefined) {
          // ABSENCE PASS-THROUGH: the inner source answered "I looked and
          // there is nothing", and the runbook has nothing to add. It goes
          // back EXACTLY as it arrived so the framework still reads it as an
          // absence. The kept record files as 'error' — the closed outcome
          // word nearest "the traversal ended on a thrown signal".
          keepRecordOf('error');
          return signal.absence;
        }
        keepRecordOf('error');
        throw e;
      }
      if (executor.isPaused()) {
        keepRecordOf('paused');
        const err = new Error(
          `${label}: the inner chart paused. Approval-gate integration (typed resume ` +
            `through agent.resume) is the runbook program's next phase; until it lands a ` +
            `paused procedure cannot be resumed through the tool boundary. The checkpoint ` +
            `is on err.checkpoint.`,
        );
        (err as Error & { checkpoint?: unknown }).checkpoint = executor.getCheckpoint();
        throw err;
      }

      const raw = executor.getSnapshot();
      keepRecordOf('ok', raw);
      const state =
        (raw as { sharedState?: Readonly<Record<string, unknown>> }).sharedState ??
        (raw as { values?: Readonly<Record<string, unknown>> }).values ??
        {};

      // ── The walk ────────────────────────────────────────────────────────
      const entries = walkRecorder.getEntries() as unknown as NarrativeEntryView[];
      const projected = projectWalk(entries, walkCap);
      const walkOnly = await mintWalk(ctx, projected, {
        toolName: opts.name,
        toolCallId: ctx.toolCallId,
        ...(ctx.runId !== undefined && { runId: ctx.runId }),
        stepsExecuted: walkRecorder.stepCount,
      });

      // ── The recording, beside the walk (opt-in) ─────────────────────────
      // The row projection cannot be drawn — `structure` is the only route to
      // a drawable graph and no snapshot carries it. The snapshot here is the
      // REDACTED mirror, not `raw`: the same `redact` policy that scrubs the
      // walk must scrub this by the same rule, and `raw` is the live working
      // memory. With no policy configured the flag is a documented no-op.
      const walk =
        recordingPolicy === undefined
          ? walkOnly
          : {
              ...walkOnly,
              ...(await mintChartRecording(
                ctx,
                chartRecordingOf(executor.getSnapshot({ redact: true }), chart.buildTimeStructure),
                {
                  toolName: opts.name,
                  toolCallId: ctx.toolCallId,
                  ...(ctx.runId !== undefined && { runId: ctx.runId }),
                  policy: recordingPolicy,
                },
              )),
            };

      // ── The projection (verdict kinds only) ─────────────────────────────
      let rows: VerdictRow[] | undefined;
      let shown: VerdictRow[] | undefined;
      let declined: number | undefined;
      if (isVerdictKind) {
        rows = verdictRowsOf(state);
        shown = rows.slice(0, maxRows);
        declined = rows.filter((row) => row.verdict === DECLINED_VERDICT).length;
      }
      const meanings =
        identity !== undefined && harvest !== undefined
          ? composeMeanings(identity, harvest.observed)
          : undefined;

      // ── The ledger ──────────────────────────────────────────────────────
      // The procedure's display name: the chart's own root name (what the
      // author called it) — the tool name is the fallback, never the
      // auto-generated multi-line description.
      const chartName =
        (chart.buildTimeStructure as { name?: string } | undefined)?.name ?? opts.name;
      const ledger = composeLedger(foldInnerCoverage(dispatch.records), chartCoverageOf(state), {
        chartName,
        stepsExecuted: walkRecorder.stepCount,
        ...(opts.rules !== undefined && { rules: opts.rules }),
        ...(rows !== undefined && { rowsTotal: rows.length }),
        ...(declined !== undefined && { declinedRows: declined }),
      });

      // ── Provenance — re-emitted FIRST ───────────────────────────────────
      const af_provenance = {
        ...carriedProvenanceOf(dispatch.records),
        tool: opts.name,
        toolCallId: ctx.toolCallId,
      };

      // ── The envelope ────────────────────────────────────────────────────
      // The spine and the projection are assembled FIRST, and the chart's
      // `report` is admitted against the names they took: spine keys win, as
      // the contract says, by explicit precedence rather than by spread order
      // (which had the report land on top of `af_provenance` and
      // `rule_version`). A refused field is named in `report_note` — see
      // report.ts for the law and why the refusal is spoken.
      const spine = {
        af_provenance,
        rule_version: opts.rules?.version ?? 'undeclared',
        walk,
      };
      // The rowset half is the same in both presentations — the dial names who
      // RENDERS the rows, never which rows there are. Only the surface differs:
      // prose gets the pre-rendered table plus "output it verbatim"; a panel
      // host gets no table and the opposite law, because the rows it would
      // retype are already on the reader's screen.
      const projection =
        shown !== undefined && rows !== undefined
          ? {
              verdicts: shown,
              rows_shown: shown.length,
              rows_total: rows.length,
              rows_complete: shown.length === rows.length,
              ...(rendersItsOwnRows
                ? { render_note: PANEL_RENDER_NOTE }
                : { table: renderVerdictTable(shown), render_note: VERDICT_RENDER_NOTE }),
              ...(meanings !== undefined && { verdict_meanings: meanings }),
            }
          : undefined;
      const report = admitReport(bagOf(state.report) ?? {}, [
        ...Object.keys(spine),
        ...reservedProjectionNames(projection),
      ]);
      const envelope: RunbookEnvelope = {
        af_coverage: ledger,
        result: {
          af_provenance: spine.af_provenance,
          rule_version: spine.rule_version,
          ...report.fields,
          ...(projection ?? {}),
          ...(report.refused.length > 0 && {
            [REPORT_NOTE_KEY]: shadowedFieldsNote(report.refused),
          }),
          walk: spine.walk,
        },
      };
      return envelope;
    },
  });

  if (store === undefined) return tool;
  const keepsRecords: Tool & KeepsInnerRuns = { ...tool, [INNER_RUN_RECORDS]: store };
  return keepsRecords;
}
