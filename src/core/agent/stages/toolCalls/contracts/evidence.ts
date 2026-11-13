import type { Classifier } from '../../../../../classify/types.js';
import type { ResolvedEvidenceGate } from '../../../evidence/types.js';
import type { InputsRouteArm } from '../../route.js';
import type { ToolResultColumns } from '../../../../../integrity/column-types/types.js';
import type { ColumnCheckMode } from '../../../../../integrity/column-types/check.js';
import type { ReadRunTime } from '../../../../../time/clock.js';
import type { ZoneName } from '../../../../../time/zone.js';
import type { TimePolicy } from '../../../../../time/resolveRecord.js';
import type { TimeAskMessages } from '../../../../../time/ask.js';

/** The evidence dependencies of the existing tool-call stage. */
export interface ToolEvidencePort {
  /**
   * True when the agent declared a `.claims()` contract (9.61.0). The claim
   * ledger accumulates ONLY then: an agent whose tools return semantic
   * envelopes but who declared no contract has nothing that would ever read
   * those rows, and writing them would be committed state — and a growing
   * checkpoint — bought for nobody.
   */
  readonly collectClaimFacts?: boolean;
  /**
   * THE FINDINGS LEDGER IS ARMED (9.101.0, `.findings()`) — present only
   * then, only ever `true`. Three things happen in `execute` and nowhere
   * else, each gated on this: the previous batch's STANDINGS are read off
   * every call's `_findings.previous` before `toolResults` is reset; the
   * reserved argument is PEELED off each call's args as the first read of
   * `tc.args` in the loop (`peelCall` — unless the tool answering the name
   * owns the property, when the value is the author's argument), so
   * `callArgs` — middleware, validation, check-in evidence, wants,
   * credentials, execute, the pause and halt carriers — never sees the
   * model's declaration; and a BASIS row is filed the moment a call
   * declares one, before `tool_start` and before any pause `return`. The
   * resume doors file nothing (the pre-pause commit already has the row).
   * History keeps `toolCalls[].args` verbatim: the emission. Absent — the
   * default — and not one of those lines runs.
   */
  readonly findings?: true;
  /**
   * THE SCRIPT RECORD IS ARMED — `.namesAndNumbersFromEvidence({ code:
   * 'match' })` or `.scriptTravelsWithTheAnswer()`; present only then, only
   * ever `true`. Each call of a tool that declares `Tool.script` files ONE
   * `script` row (`../../../scripts/rows.ts`) where the call settles — every
   * `tool_end`-emitting path and the batch settlement — and a `submitted`
   * row, without its text, where it pauses: the program SUBMITTED to the
   * tool (the arguments handed to `execute`, after any before-tool
   * middleware) and the label its execution record earns
   * (`../../../scripts/label.ts`). Never evidence, never on an event. Absent — the
   * default — and not one line of it runs, and no tool is asked for its
   * declaration.
   */
  readonly scriptRecord?: true;
  /**
   * THE INPUTS LAYER IS MOUNTED (honesty layer 2) — present only then, only
   * ever `true`. Under it, the batch loop reads `argumentResolutions` (what
   * `sf-inputs` resolved for THIS batch — entries stamped with another
   * iteration are ignored) and, per call, applies the entry AFTER
   * `tool_start` (which keeps the model's proposal) and BEFORE the permission
   * check: a fill builds a fresh `{ ...args, ...fills }` that permission,
   * middleware, validation, check-in, credentials and execute all see, and a
   * refused entry lands in the argument-refusal shape — after permission and
   * BEFORE the middleware chain, so no middleware asks about a call that will
   * not run (the ask-resume door re-applies it). A call that ran on a filled
   * value gets the layer's past-tense note after the tool's own bytes — one
   * clause per fill it really ran with — and its history message carries
   * `toolChars`. ABSENT, a call whose tool declares argument rules is REFUSED
   * (fail closed — a ToolProvider served it and the build could not see it),
   * at the same place and at the same door, with one warning naming
   * `.inputsLayer()`; every other call runs exactly as it always did.
   */
  readonly inputsLayer?: true;
  /**
   * DECLARED SOURCES ARE ARMED (honesty layer 2, `.findings({ argumentSources:
   * true })` or `.inputsLayer({ argumentSources: true })`) — present only
   * then, only ever `true`, and only beside `inputsLayer`. The per-call peel
   * reads `_findings.from` exactly as the inputs layer read it
   * (`findings/reserved.ts` · `splitFindings`'s arms), so a `from`-only
   * declaration is readable and — beside `findings` — a dropped `from` entry
   * is counted on the call's basis row. WITHOUT `findings` the peel takes the
   * argument off a RULED tool's calls only (the only ones it was planted on)
   * and files no basis row: the layer put the count on the call's first
   * argument row. An answered note gains the clause that a later call may cite
   * the answer. The checks themselves ran in the layer, before this stage;
   * nothing else here reads `from`.
   */
  readonly argumentSources?: true;
  /**
   * The results layer is mounted (honesty layer 3, step 7b) — a registered
   * tool declares a `ToolPeriod`, or the agent was built with
   * `.resultsLayer()`. Present: dispatch stamps the batch with the iteration
   * that ran it (`AgentState.toolResultsIteration`, how the layer tells a
   * batch from a re-entry), and the one ledger writer stamps the turn.
   * Absent: a result that declares a `period` is still recorded (the tool's
   * declaration rides `coverageDeclared` and the events either way), and a
   * dev warning says, once per tool, that no verdict will be filed for it.
   */
  readonly resultsLayer?: true;
  /**
   * `.negativeClaims()` is armed: a
   * composed absence's `tools.absent` carries `lookedForRef` in place of
   * `lookedFor`. Composed values ride no event in any mode; unarmed,
   * `lookedFor` is today's bytes. Absent → unarmed.
   *
   * @internal
   */
  readonly negativeClaimsArmed?: boolean;
  /**
   * THE ANSWER LAYER IS ARMED (honesty layer 4, `.answerLayer()`) — the ONE
   * thing it changes here is the turn stamp: while any honesty layer is armed
   * the one writer stamps every row it files with the conversation turn
   * (adopted Q6), so the rows this handler files (basis, standing, judgment,
   * contingent) carry `turn`. Absent → the rows are filed as they always were.
   */
  readonly answerLayer?: true;
  /**
   * THE JUDGE (9.104.0, `.findings({ judge })`) — present only with the arm
   * and only when a classifier was configured. After every landed result is
   * committed to `toolResults` — the execute loop and the four resume doors
   * alike — `findings/judge.ts · judgeResult` spends one classifier call and
   * files a `JudgmentRow` (or a `JudgmentErrorRow`) BEFORE the next model
   * call, so the record carries the second source's reading beside the
   * model's before anything is served; nothing is served from it in this
   * release. Only a result the TOOL produced is judged — a denial, a halt,
   * a fail-closed refusal or a declined check-in is the library's sentence
   * about a call that never ran, never evidence (`judgeLanded`). Absent —
   * the default — and not one line runs.
   */
  readonly findingsJudge?: Classifier;
  /**
   * THE TOWERS AT DISPATCH (9.110.0, `.findings()` beside
   * `.namesAndNumbersFromEvidence()`) — the resolved evidence gate, present
   * ONLY when both doors are armed. Under it, once per batch and only when
   * the ledger's fold holds a set-aside standing (`open`, `noise`,
   * `ruled-out`), the batch's evidence corpus is built from the history this
   * call was served (`evidence/evidenceIndex.ts · evidenceFromHistory` —
   * the same fold the route decider asks at the answer, one stage earlier)
   * and every call's peeled arguments are read for DATA values the corpus
   * holds (`findings/contingent.ts · groundedArgumentValues`); a value whose
   * every carrier the model itself set aside files a `ContingentRow` through
   * the one writer, after the call's basis row and before `tool_start`.
   * Absent — the default, and every agent with one door or neither — and not
   * one line runs.
   */
  readonly evidenceGate?: ResolvedEvidenceGate;
  /**
   * What the dispatch moment exempts beside the evidence gate — the SAME arm
   * the route decider judges the answer with (`runtime/routing/exemptArm.ts`),
   * so a value the person gave the batch ask, a declared default this turn
   * assumed, or a time the person said is exempt at both moments
   * (`route.ts` · `exemptForTurn`). Present only beside `evidenceGate` with
   * the inputs layer armed.
   */
  readonly evidenceExempt?: InputsRouteArm;
  /**
   * THE WRITE SEAM (9.77.0, `empty-lookup`) — the declared argument-ground
   * edges (`Tool.argumentsFrom`) by tool name, present ONLY when the operator
   * turned `AgentOptions.noticeEmptyLookups` on AND at least one tool declares
   * one. Absent — the default — and not one line of the check runs.
   *
   * The same harvested map `callLLM` reads for the choice seam, and passed
   * rather than re-derived from `registryByName` on purpose: the two stages
   * must agree, by construction, about which calls are armed. Deriving it here
   * would arm `ToolProvider`-delivered tools that the choice seam structurally
   * cannot see, and the two seams' ledger rows would then disagree about the
   * same run.
   */
  readonly emptyLookupGrounding?: ReadonlyMap<string, readonly string[]>;
  /**
   * THE WRITE SEAM'S other check (9.78.0, the COLUMN-TYPE CONTRACT) — each
   * declaring tool's `Tool.resultColumns` by tool name, present ONLY when the
   * operator's `checkColumnTypes` dial is off `'off'` AND at least one tool
   * declares columns. Absent — the default — and not one line of the check
   * runs.
   *
   * Harvested in `Agent.buildChart` from the same catalog the other seams
   * read, and passed rather than re-derived here for the `emptyLookupGrounding`
   * reason: the stage that files the "nothing to judge this response"
   * not-applicable row and the stage that judges must agree, by construction,
   * about which tools are armed.
   */
  readonly columnDeclarations?: ReadonlyMap<string, ToolResultColumns>;
  /** What the boundary does with a column finding — `'warn'` files and changes
   *  nothing, `'enforce'` refuses the rows. Present with
   *  {@link ToolCallsDeps.columnDeclarations} or not at all. */
  readonly columnCheckMode?: ColumnCheckMode;
  /**
   * The per-run disposition ledger, by REFERENCE (9.60.0) — the same holder
   * `callLLM` and the tools slot are handed, shared through the build closure
   * and never scope state. Read by the write-seam check only; a handler built
   * without it simply files no rows.
   */
  readonly integrityLedger?: {
    current: import('../../../../../integrity/disposition/ledger.js').DispositionLedger | undefined;
  };
  /**
   * THE TIME LAYER (`.time()`) — present only then. Each dispatched call files
   * one `call` row with `dispatchedAt` (the wall clock, just before the tool
   * runs: a tool evaluates a look-back against its own clock at dispatch,
   * which after a pause is later than the turn's `now`). `takePassedOnResume`
   * hands over the `time` the current resume passed, as read, ONCE (a second
   * call answers `undefined`) — the first ToolCalls pass of the resumed leg
   * compares it with the turn's kept clock and files `clock-on-resume` when
   * they differ; the kept clock is never replaced. A call whose tool's period
   * declares forms is handed `ctx.time` (read off its `call-window` row), and
   * the batch ask judges a period answer against the tool's facts at the
   * turn's clock (`appZone`: the app's `.time({ zone })`).
   *
   * @internal
   */
  readonly time?: {
    readonly takePassedOnResume: (scope: object) => ReadRunTime | undefined;
    readonly appZone?: ZoneName;
    /**
     * Present exactly under `.time({ reader })` (step T6b): the batch ask asks
     * a period left out while the turn's one mention is open as THAT
     * mention's window — the lazy word-driven ask (`../../argumentAsk.ts` · `windowPlanOf`).
     */
    readonly reader?: {
      readonly policy: TimePolicy;
      readonly messages?: Partial<TimeAskMessages>;
    };
  };
}
