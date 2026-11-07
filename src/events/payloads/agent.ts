import type { LLMMessage, TurnEndScripts } from './dependencyTypes.js';
import type { AnswerAssessmentPayload, AnswerNegativesPayload } from './answer.js';
import type { PeriodPayload } from './toolEffects.js';
import type { CoverageItemPayload, InProgressItemPayload } from './toolSemantics.js';

// agent.* (7)
export interface AgentTurnStartPayload {
  readonly turnIndex: number;
  readonly userPrompt: string;
}

/**
 * A `.aroundTurn()` wrapper threw after its run went well. The outcome stands;
 * this is the only record of the failure. The error's class, never its message.
 */
export interface AgentAroundTurnFailedPayload {
  readonly wrapper: string;
  readonly errorClass: string;
}

export interface AgentTurnEndPayload {
  readonly turnIndex: number;
  readonly finalContent: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly iterationCount: number;
  readonly durationMs: number;
  /**
   * Why the loop stopped before the model said it was done (9.56.0) — present
   * ONLY on a turn a limit cut short, absent on every normal finish.
   *
   * It rides `turn_end` because that is the event a consumer already reads to
   * render an outcome: the moment the answer exists. Reading `finalContent`
   * without it, a dashboard cannot tell a finished answer from the fragment a
   * loop stopped in the middle of — which is exactly how a half-sentence gets
   * shown to a person under a green tick.
   *
   * `wrappedUp` says which of the two this is. `true` = the run spent one more
   * call with the tools withheld and `finalContent` is that summary; absent =
   * the turn ended on whatever the last call produced. Mirrors the committed
   * `stoppedEarly` record (`agent.stoppedEarly()`), never a second source of
   * it.
   */
  readonly stoppedEarly?: {
    readonly reason: 'max-iterations' | 'cost-budget';
    readonly iteration: number;
    readonly pendingToolCalls: number;
    readonly wrappedUp?: true;
  };
  /**
   * The limits of a TYPED answer, as data — present ONLY when the agent has an
   * output schema and `.limitsTravelWithTheAnswer()`, and the run's tools
   * declared something; absent on every other turn.
   *
   * A prose answer carries its limits as a block appended to `finalContent`.
   * A typed answer cannot: it is JSON, and JSON followed by prose is not JSON.
   * So `finalContent` stays the model's answer and the same limits ride here —
   * what the tools `checked`, did not check and can never cover, folded across
   * the run (duplicates said once, every entry kept). Mirrors the committed
   * `answerCoverage` record (`agent.answerCoverage()`), never a second source
   * of it.
   */
  readonly answerCoverage?: {
    readonly checked: readonly CoverageItemPayload[];
    readonly notChecked: readonly CoverageItemPayload[];
    readonly cannotCover: readonly CoverageItemPayload[];
    /**
     * The periods the calls' results declared (honesty step 7b) — one per
     * declaring call, as declared; present only when one did. The data twin of
     * a prose answer's `Period:` lines.
     */
    readonly periods?: readonly (PeriodPayload & {
      readonly toolName: string;
      readonly toolCallId?: string;
    })[];
    /**
     * What the calls' reads found still running — its outcome not known yet —
     * one entry per declaring call, as declared; present only when one did.
     * The data twin of a prose answer's "In progress" lines.
     */
    readonly inProgress?: readonly {
      readonly toolName: string;
      readonly toolCallId?: string;
      readonly items: readonly InProgressItemPayload[];
    }[];
    /**
     * The values a tool's `assume` rule filled this turn (the inputs layer,
     * honesty layer 2) — the SAME rows, read the same way, that the prose
     * answer's "Assumed" block prints (`arguments/serve/assumed.ts` ·
     * `assumedLinesFor`): one entry per distinct (tool, argument, value), a
     * row a before-tool rewrite superseded left out. `value` is the tool's
     * own argument view; `'REDACTED'` with `hidden` when that view hides it.
     * Present only when a value was assumed.
     */
    readonly assumed?: readonly {
      readonly toolName: string;
      readonly argument: string;
      readonly value: string;
      readonly hidden: boolean;
    }[];
  };
  /**
   * The answer's standing, as data — present ONLY on an agent with
   * `.answerLayer()` (honesty layer 4), and then on every turn that ends in
   * an answer. The same projection `agentfootprint.answer.assessed` carries
   * ({@link AnswerAssessmentPayload}): the value, its rendering, the reason
   * kinds and the checks that ran; never a value or a quote. It rides
   * `turn_end` because that is the event a consumer already reads to render
   * an outcome — including a composition that mounts the agent, whose
   * dispatcher carries the agent's `turn_end` but not the `answer.*` domain.
   */
  readonly answerAssessment?: AnswerAssessmentPayload;
  /**
   * The app's words the appended standing line named calls in — registered
   * tool name → the tool's declared `displayName`. Present ONLY when the line
   * (`.answerLayer({ standingLine: true })`) named a reason's calls by a
   * declared name, so every other turn emits the exact payload it always did.
   * The words are the app's own, already in `finalContent`; the record keeps
   * them so a reader rebuilds the very line from the record.
   */
  readonly standingLineNames?: Readonly<Record<string, string>>;
  /** Runtime-composed typed negatives, with verification and delivery kept separate. */
  readonly answerNegatives?: AnswerNegativesPayload;
  /**
   * The scripts the library attached to the answer — present ONLY under
   * `.scriptTravelsWithTheAnswer()`, on every answer. Each `shown` entry is
   * the program a call SUBMITTED to a declared code-running tool, read from
   * the run record (never retyped by the model), with the call's label read
   * from its execution record: `exitCode` only when the runner supplied one,
   * `truncated` when the text is cut at `maxBytes`. `omitted` counts the
   * calls not attached (the cap, a program over the bound, a call past the
   * per-turn rows). A prose answer also carries them as text after its `---`
   * separator; a typed answer carries them here only. `text` is a
   * model-written string: under any redaction policy it is served as the
   * placeholder, and the label and the counts survive.
   */
  readonly scripts?: TurnEndScripts;
  /**
   * The answer was REFUSED — present ONLY then. Under the evidence gate's
   * `'rails'` posture (`.namesAndNumbersFromEvidence()`), an answer stating
   * values no tool result carried is not delivered: `run()` raises
   * `UnsupportedValuesError`. `finalContent` stays for the record (the answer
   * account explains the refusal from it), but it is NOT the agent's answer —
   * a consumer rendering an outcome shows the refusal, never this text.
   */
  readonly refused?: { readonly by: 'evidence-rails' };
}

/**
 * A turn's budget ran out while the model was still working (9.56.0).
 *
 * Fires ONCE per turn, from the Route decider, at the boundary that refused to
 * run the tool calls the model just asked for — the same moment
 * `cost.limit_hit { kind: 'max_iterations' }` fires, and beside it rather than
 * instead of it: that event reports a LIMIT being crossed, this one reports
 * what the run then DID about it.
 *
 * `action` is the whole point. `'wrapped-up'` means one more call went out with
 * the tools withheld and its answer is the turn's answer; `'cut-short'` means
 * the turn ended on whatever text rode the last call — a fragment, mid-task,
 * more often than not. A consumer that only ever sees `'wrapped-up'` is
 * looking at a healthy default; one seeing `'cut-short'` is looking at a turn
 * whose answer nobody should trust as complete.
 */
export interface AgentBudgetExhaustedPayload {
  /** Which budget ran out. Only `'max-iterations'` is ever wrapped up. */
  readonly reason: 'max-iterations' | 'cost-budget';
  /** The iteration the budget ran out on. */
  readonly iteration: number;
  /**
   * The budget itself — present ONLY for `'max-iterations'`, where it is
   * `maxIterations`.
   *
   * Absent for `'cost-budget'`, deliberately: the run's committed state carries
   * the cumulative SPEND, not the cap, and reporting spend as `limit` is the
   * exact mistake `cost.limit_hit` documents and avoids. The real USD cap rides
   * that event, emitted the moment the budget was crossed.
   */
  readonly limit?: number;
  /** How many tool calls the model asked for that will never run. */
  readonly pendingToolCalls: number;
  /** What the run did about it. */
  readonly action: 'wrapped-up' | 'cut-short';
}

export interface AgentIterationStartPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
}

export interface AgentIterationEndPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  /**
   * On the main loop, the calls the turn proposed. On a resume leg (9.113.0),
   * the brackets THAT leg closed: the paused call plus each sibling the batch
   * settlement answered — so a batch of three paused on its middle call
   * reports 2, and the calls before the pause are counted by no
   * `iteration_end` (their brackets closed on the leg that paused). For the
   * batch's size, read `tool_start.parallelCount`. See `src/core/README.md` ·
   * "A batch that pauses settles its un-dispatched siblings".
   */
  readonly toolCallCount: number;
  /** Conversation history (LLM messages) at the END of this
   *  iteration. Captured by `agent.run()` for fault-tolerant
   *  resume — `RunCheckpointError.checkpoint` snapshots this so
   *  `agent.resumeOnError(...)` can replay from the last good
   *  iteration. Optional for back-compat with v2.x recorders that
   *  subscribed without expecting this field. Typed as the messages it
   *  holds, so its field names and roles are the library's own words on a
   *  redacted record (`redaction/knownStrings.ts`). */
  readonly history?: ReadonlyArray<LLMMessage>;
}

/**
 * The `route_decided` rationales that are FIXED sentences — the library's own
 * words, so a redacted record keeps them (`redaction/knownStrings.ts`). A
 * rationale composed per turn (a count of calls, a skill's name) is a free
 * string there, kept out under a policy like any other.
 */
export type FixedRouteRationale =
  | 'LLM produced no tool calls — final answer'
  | 'maxIterations reached — forcing final'
  | 'costBudget reached (onExceed: halt) — forcing final'
  | 'tools are off after the evidence revision (answer validation enforces) — forcing final';

/**
 * The `pause.request` reason the library writes when the pause carries none —
 * the library's own words (`redaction/knownStrings.ts`). A reason the pause
 * carries is a free string.
 */
export type FixedPauseReason = 'stage requested pause';

export interface AgentRouteDecidedPayload {
  readonly turnIndex: number;
  readonly iterIndex: number;
  /**
   * The branch the turn took. `'output-retry'` (7.26) appears only on an
   * agent built with `.outputSchema(parser, { retries })`, and only on a
   * turn whose answer failed the schema with retries left — the loop is
   * about to ask again rather than finish. `'step-nudge'` (9.18.0) appears
   * only on an agent with a stepped skill, and only on a turn whose
   * would-be-final answer left declared steps unrun with the one teaching
   * nudge still unspent. `'evidence-recheck'` (9.35.0) appears only on an
   * agent built with `.namesAndNumbersFromEvidence({ posture: 'guard' |
   * 'rails' })`, and only on a turn whose would-be-final answer stated values
   * no tool result carried, with the one revision still unspent. `'wrap-up'`
   * (9.56.0) appears only on a turn whose `maxIterations` ran out while the
   * model was still asking for tools, on an agent that did not set
   * `wrapUpAtMaxIterations: false` — the loop is about to spend one last call
   * with the tools withheld so the turn ends with a summary.
   */
  readonly chosen:
    | 'tool-calls'
    | 'final'
    | 'output-retry'
    | 'step-nudge'
    | 'evidence-recheck'
    | 'negative-recheck'
    | 'wrap-up';
  readonly rationale?: FixedRouteRationale | (string & Record<never, never>);
}

export interface AgentHandoffPayload {
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly reason?: string;
  readonly viaProtocol?: 'native' | 'mcp' | 'http';
}
