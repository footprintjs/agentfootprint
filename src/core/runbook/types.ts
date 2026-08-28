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
   */
  readonly decider: string;
  /** Cap on `verdicts` rows AND the rendered table — ONE number for both
   *  halves (a longer list beside a shorter table is an invitation to retype
   *  identifiers). Default 50. */
  readonly maxRows?: number;
}

/** The walk policy. */
export interface RunbookWalkOptions {
  /** Row cap on the minted walk (default 500). When the full walk does not
   *  fit, the CONTROL FLOW survives — see `walk.ts` for the projection law. */
  readonly cap?: number;
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
    /** Pre-rendered markdown table over the SAME rows as `verdicts`. */
    readonly table?: string;
    /** The render law, stated to the model. Present with `table`. */
    readonly render_note?: string;
    /** branch → meaning, GENERATED from the decider's declared branches and
     *  the rule labels this run's evidence carried — never hand-restated. */
    readonly verdict_meanings?: Readonly<Record<string, string>>;
    /** Everything the chart put in its `report` state key — the app's own
     *  result fields, spread here verbatim (spine keys win). */
    readonly [appField: string]: unknown;
  };
}
