/**
 * runbook/types — the vocabulary of the runbook bridge.
 *
 * Pattern: one options bag, four concerns (declarations, procedure, evidence
 *          policy, walk policy) + one envelope type split into a MANDATORY
 *          SPINE and an OPTIONAL projection. Pure data, no behavior.
 * Role:    core/ layer. `runbookAsTool.ts` consumes; consumers read the
 *          envelope types when they assert on results.
 * Emits:   N/A.
 *
 * The SPINE / PROJECTION split is load-bearing honesty, not taste: the spine
 * (coverage, provenance, rule version, the recorded walk) is what EVERY
 * runbook ships whatever its shape, so an answer can never arrive without its
 * boundary; the verdict/rowset projection is one shape of answer (a triage),
 * selected by `resultKind: 'verdict/*'` — an action-taking runbook ships the
 * spine plus its own `report` payload and no rowset. The spine's wire shape
 * is explicitly PROVISIONAL until a second, differently-shaped consumer has
 * shipped through it.
 */

import type { CombinedRecorder, FlowChart, RedactionPolicy } from 'footprintjs';
import type { CoverageItem } from '../agent/coverage/types.js';
import type { ToolDispatch, ToolOwner, ToolResultCeiling } from '../tools.js';
import type { ToolResultClass } from '../../lib/semantics/types.js';
import type { ToolWants } from '../../artifacts/wants.js';

/**
 * The procedure: a factory invoked PER CALL with the run's own tool dispatch
 * (`ctx.tools`), returning a FRESH chart whose stages close over it.
 *
 * Per call for two reasons that are really one: a chart shared between two
 * runs is a chart whose closures belong to whichever run built it last, and
 * the dispatch only exists at execute time — so the factory is both the
 * fresh-chart law and the delivery mechanism.
 *
 * It is ALSO invoked once at definition time, with a probe dispatch whose
 * `has` answers false and whose `call` refuses — to read the chart's declared
 * contract (input schema, the named decider's branches). Stage bodies do not
 * run at build, so a well-formed factory pays nothing; a factory with side
 * effects at build time is a factory that lies about being a declaration.
 */
export type RunbookProcedure = (tools: ToolDispatch) => FlowChart;

/** Rule provenance — threaded bridge → envelope → coverage sentence, so an
 *  answer produced under one reading of the rules can be told apart from an
 *  answer produced under the next. */
export interface RunbookRules {
  /** The rule set's name ('health-signal'). Non-empty. */
  readonly name: string;
  /** Its version stamp ('v1'). Non-empty; bump when the READING changes,
   *  never for wording. */
  readonly version: string;
}

/** The verdict/rowset projection's dials. */
export interface RunbookVerdictsOptions {
  /**
   * The decider stage (by id or name) whose declared branch labels generate
   * `verdict_meanings`. Branch descriptions come from the chart's own
   * structure when the decider is statically declared; rule labels observed
   * in this run's decide() evidence refine them (and are the only source
   * when the decider lives inside a dynamically generated fan-out branch,
   * where build-time structure cannot see it).
   *
   * The DEFAULT branch is chosen by no rule, so no rule label describes it.
   * Name it where the rules are named — `decide(scope, rules, { branch,
   * label })` — and the label arrives here on the same evidence:
   *
   * ```ts
   * decide(scope, rules, { branch: 'protected', label: 'No rule fired — asset stays protected' });
   * ```
   */
  readonly decider: string;
  /** Cap on `verdicts` rows AND the rendered table — ONE number for both
   *  halves (a longer list beside a shorter table is an invitation to retype
   *  identifiers). Default 50. */
  readonly maxRows?: number;
}

/**
 * WHO RENDERS THE ROWSET — the one thing about its client a runbook cannot
 * work out for itself.
 *
 * `'prose'` — the model's prose is the rowset's only surface (a chat client,
 * a log line, an email). The envelope ships the pre-rendered `table` and tells
 * the model to output it verbatim, because retyping is the only alternative.
 *
 * `'panel'` — the host draws the rowset itself (a data panel, a grid, a
 * report page). The envelope ships NO `table`, and says so: reproducing rows
 * the reader is already looking at is the same transcription risk, run for no
 * gain.
 */
export type RunbookPresentation = 'prose' | 'panel';

/** The walk policy. */
export interface RunbookWalkOptions {
  /** Row cap on the minted walk (default 500). When the full walk does not
   *  fit, the CONTROL FLOW survives — see `walk.ts` for the projection law. */
  readonly cap?: number;
  /**
   * ALSO file the inner chart's own RECORDING (9.79.0) — `{ snapshot, events,
   * structure }`, the shape `observeRecording()` mounts — under kind
   * `'recording/run'`, and put its ref on the spine as
   * `result.walk.recording_ref`.
   *
   * `true` for the defaults, or `{ label, maxBytes }` to set them yourself.
   *
   * ── Off by default, and why that is not timidity ─────────────────────────
   * The walk is a PROJECTION: eight declared columns per row, values off by
   * construction (`narrative({ includeValues: false })`), so a walk carries
   * sentences about what happened and no payload from it. A recording is the
   * run: the chart's shared state, its whole commit log, and every attached
   * recorder's data. Filing one is a materially bigger promise — it carries
   * whatever the chart WROTE — so it is a thing an operator declares, never a
   * thing a library starts doing to them. Unset, not one extra line runs: no
   * second snapshot is taken, no bytes are measured, no store call is made,
   * and the envelope is byte-identical to 9.78.0.
   *
   * ── What it buys ────────────────────────────────────────────────────────
   * The row projection cannot be drawn. `structure` — the chart's build-time
   * graph — is the only route to a drawable flowchart, and no snapshot carries
   * it; a consumer handed 129 rows can only correctly REFUSE to infer the step
   * graph from them. With the recording filed, the lens/explainable-UI flow
   * components mount the runbook's walk as the flowchart it actually ran.
   *
   * ── Redaction, once, for both ───────────────────────────────────────────
   * The recording's snapshot is read from the REDACTED MIRROR
   * (`getSnapshot({ redact: true })`), so the `redact` policy that scrubs the
   * walk scrubs the recording by the same rule at the same moment. One policy,
   * one meaning, both artifacts.
   *
   * ── Best-effort, and the absence is STATED ──────────────────────────────
   * `mintWalk`'s own law: no store, an over-size refusal, or a failed mint
   * costs the REF, never the answer — and `walk.recording_note` says which,
   * so a reader never has to guess why a ref is missing. With this option
   * unset, the descriptor says nothing about a recording at all.
   */
  readonly recording?: boolean | RunbookRecordingOptions;
}

/** The object form of {@link RunbookWalkOptions.recording}. */
export interface RunbookRecordingOptions {
  /**
   * The label the minted recording carries, verbatim.
   *
   * Absent, it is `<toolName> recording`. A static label repeats across calls
   * on purpose — what distinguishes two recordings is the ref and
   * `origin.toolCallId`, and a library that decorated the name you chose to
   * make it unique would be overruling you (the `recordingPutInput` law).
   */
  readonly label?: string;
  /**
   * The size ceiling, in bytes of the serialized recording. Default
   * `DEFAULT_RECORDING_MAX_BYTES` (5,000,000).
   *
   * Over it, the recording is NOT filed and `recording_note` says so with both
   * numbers and this option's name. It is a refusal rather than a truncation
   * on purpose: the walk can be projected because rows are independently
   * meaningful, but `{ snapshot, events, structure }` is not row-shaped —
   * half a commit log under a whole chart is a recording that draws a picture
   * nobody can check, which is worse than a stated absence. A fleet sweep that
   * genuinely needs the whole thing raises this number, deliberately.
   */
  readonly maxBytes?: number;
}

/** Everything `runbookAsTool` accepts. Smallest legal call:
 *  `{ name, description, procedure }` — and it still yields the spine. */
export interface RunbookAsToolOptions {
  /** Tool name the LLM dispatches by. */
  readonly name: string;
  /** REQUIRED — a description-less tool is invisible to the model. */
  readonly description: string;
  /** The procedure factory — see {@link RunbookProcedure}. */
  readonly procedure: RunbookProcedure;

  // ── Declarations (forwarded verbatim into defineTool — GAP-8) ──────────
  /** Selects the envelope projection (`'verdict/*'` gets the rowset) AND is
   *  the artifact kind a placed result is minted under. */
  readonly resultKind?: string;
  readonly resultClass?: ToolResultClass;
  readonly owner?: ToolOwner;
  readonly resultCeiling?: ToolResultCeiling;
  readonly wants?: ToolWants;
  readonly argumentsFrom?: readonly string[];
  /** The named ingredient tools the procedure calls through `ctx.tools` —
   *  drift-checked at agent build. */
  readonly composedOf?: readonly string[];
  /** Explicit input schema wins; otherwise the chart's `.contract()` input
   *  is lifted when it is a plain JSON-Schema object (a parseable schema —
   *  zod et al. — cannot be serialized for the model and falls back to the
   *  empty-object default). */
  readonly inputSchema?: Readonly<Record<string, unknown>>;

  // ── Evidence policy ────────────────────────────────────────────────────
  /** Rule provenance — see {@link RunbookRules}. */
  readonly rules?: RunbookRules;
  /** The verdict projection's dials — see {@link RunbookVerdictsOptions}. */
  readonly verdicts?: RunbookVerdictsOptions;
  /** Who renders the rowset — see {@link RunbookPresentation}. Default
   *  `'prose'`; an unknown value is refused at definition, never read as the
   *  default (a mis-spelled dial that silently keeps working is a dial that
   *  cannot be trusted to have been set). */
  readonly presentation?: RunbookPresentation;
  /** The walk policy — see {@link RunbookWalkOptions}. */
  readonly walk?: RunbookWalkOptions;

  // ── Kept from flowchartAsTool ──────────────────────────────────────────
  /** Observers attached to each invocation's fresh inner executor. */
  readonly recorders?: ReadonlyArray<CombinedRecorder>;
  /** Keep each invocation's inner record for `inspect_tool_run` descent. */
  readonly keepRecord?: boolean;
  /** Bounded LRU size for kept records (requires `keepRecord: true`). */
  readonly keepRecordLimit?: number;
  /** Redaction policy for the inner run (commit-time scrub). */
  readonly redact?: RedactionPolicy;
}

/**
 * The recorded-walk descriptor — ALWAYS on the spine. The walk itself ships
 * as an artifact ticket (`ref`), never as bytes in the envelope; with no
 * store attached (or a failed mint) the descriptor still states its
 * counters and the `note` names why there is no ticket — a missing walk must
 * never be mistaken for a short run.
 */
export interface WalkDescriptor {
  /** The claim-ticket ref of the minted walk artifact. Absent when no store
   *  is attached or the mint failed — `note` says which. */
  readonly ref?: string;
  /** The artifact kind (`'recording/chart-walk'`). Present with `ref`. */
  readonly kind?: string;
  /** Rows in the minted artifact. */
  readonly rows: number;
  /** Total execution steps the narrative recorder counted — spans isolated
   *  subflow logs, which the root commit log cannot. */
  readonly steps_executed: number;
  /** `'full'` — every narrative entry fit under the cap; `'control-flow'` —
   *  it did not, and the stages/forks/subflows/decisions survived while the
   *  per-key reads and writes were dropped. */
  readonly projection: 'full' | 'control-flow';
  readonly shown: number;
  readonly total: number;
  readonly complete: boolean;
  /**
   * WHICH SEGMENT of the run this walk covers. `'full'` for an un-gated run
   * (all of phase 1). When approval gates land, a resumed run's recorders
   * start empty on the fresh executor — its walk will say `'post-resume'`
   * and its counters will count only that segment; the discriminant ships
   * NOW so the wire does not break then.
   */
  readonly walk_segment: 'full' | 'pre-pause' | 'post-resume';
  /** The human sentence: what the walk is, and (when projected) what the
   *  control-flow projection kept and dropped, or why there is no ticket. */
  readonly note: string;

  // ── The recording, when `walk: { recording }` asked for one (9.79.0) ────
  // All four are ABSENT unless the option was declared: an opt-out run's
  // descriptor says nothing about a recording, because a reader who never
  // asked for one should not have to read a sentence explaining its absence.
  /**
   * The claim-ticket ref of the inner chart's own `{ snapshot, events,
   * structure }` recording — what the lens/explainable-UI flow components
   * mount to draw this walk as the flowchart it ran. Absent when the mint was
   * refused or failed; `recording_note` says which, and never stays silent.
   */
  readonly recording_ref?: string;
  /** The recording's artifact kind (`'recording/run'`). Present with
   *  `recording_ref`. */
  readonly recording_kind?: string;
  /**
   * The recording's size in bytes. Present on the SUCCESS path (the store's
   * own measurement) AND on the over-size refusal (what it measured, beside
   * the ceiling it broke) — the one number that makes a size decision
   * checkable instead of mysterious.
   */
  readonly recording_bytes?: number;
  /**
   * The human sentence about the recording: what a filed one CONTAINS beyond
   * the walk's row projection, or the named reason there is no
   * `recording_ref`. Present whenever a recording was asked for — silence is
   * not an allowed answer to "why is the ref missing".
   */
  readonly recording_note?: string;
}

/** One verdict row, as the chart wrote it. The bridge reads rows from the
 *  final state's `verdicts` key and requires only `verdict`; every other
 *  column is the app's own vocabulary. */
export interface VerdictRow {
  readonly verdict: string;
  readonly [column: string]: unknown;
}

/** The mandatory-spine + optional-projection envelope every runbook returns
 *  (unless an inner absence passed through — then the answer IS that absence,
 *  verbatim). Recognized by the framework's coverage funnel at the dispatch
 *  boundary like any `coverage()` ledger. */
export interface RunbookEnvelope {
  readonly af_coverage: {
    readonly checked?: readonly CoverageItem[];
    readonly not_checked?: readonly CoverageItem[];
    readonly cannot_cover?: readonly CoverageItem[];
    /** The static coverage law sentence (the `coverage()` note). */
    readonly note: string;
    /** The run's own sentence — names the rule set and version. */
    readonly sentence: string;
  };
  readonly result: {
    /** Re-emitted FIRST: the carried inner provenance stamp (if any inner
     *  tool declared one — a LOCAL SEED confession survives composition)
     *  plus this call's own `{tool, toolCallId}`. */
    readonly af_provenance: Readonly<Record<string, unknown>>;
    /** `rules.version`, or the honest `'undeclared'` when no rules were
     *  declared — the field never silently vanishes. */
    readonly rule_version: string;
    /** The recorded walk — always present. */
    readonly walk: WalkDescriptor;
    // ── the verdict/rowset projection (resultKind 'verdict/*' only) ──────
    readonly verdicts?: readonly VerdictRow[];
    readonly rows_shown?: number;
    readonly rows_total?: number;
    readonly rows_complete?: boolean;
    /** Pre-rendered markdown table over the SAME rows as `verdicts`. Present
     *  under `presentation: 'prose'` (the default), where the model's prose is
     *  the rowset's only surface. ABSENT — the key itself, not an empty
     *  string — under `'panel'`, where the host draws the rowset and a second
     *  copy in prose would be a retype of what the reader can already see. The
     *  name stays RESERVED in both modes, so a chart's `report` cannot put a
     *  table back into a panel answer. */
    readonly table?: string;
    /** The render law, stated to the model — present with the projection in
     *  BOTH modes, because a rowset always ships with a rule about its
     *  surface. `VERDICT_RENDER_NOTE` under `'prose'` (output the table
     *  verbatim); `PANEL_RENDER_NOTE` under `'panel'` (the rows are already on
     *  screen — quote the evidence, never reproduce them). */
    readonly render_note?: string;
    /** branch → meaning, GENERATED from the decider's declared branches and
     *  the rule labels this run's evidence carried — never hand-restated. */
    readonly verdict_meanings?: Readonly<Record<string, string>>;
    /** Present ONLY when the chart's `report` spelled one of the envelope's
     *  own names: it names every discarded field and says the values under
     *  those names are the bridge's. Absent on the clean path. */
    readonly report_note?: string;
    /** Everything the chart put in its `report` state key — the app's own
     *  result fields, spread here verbatim BESIDE the spine. Spine keys win:
     *  a report field spelling `af_coverage`, `af_provenance`, `rule_version`,
     *  `walk`, `report_note`, or a projection key this run assembled is
     *  discarded and named in `report_note`. */
    readonly [appField: string]: unknown;
  };
}
