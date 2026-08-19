/**
 * toolCalls — pausable handler for executing the LLM-requested tool
 * calls in the agent's ReAct loop.
 *
 *   • `execute` iterates `scope.llmLatestToolCalls`, dispatches each
 *     tool, appends results to scope.history, and increments
 *     `scope.iteration`. If a tool throws `PauseRequest` (via
 *     `pauseHere()`), commits partial state and returns the pause
 *     payload so footprintjs captures a checkpoint.
 *   • `resume` runs after the consumer supplies the human's answer.
 *     Treats that answer as the paused tool's result, appends to
 *     history, then continues the ReAct iteration loop.
 *
 * Dispatch resolution order:
 *   1. Static registry built at chart-build time (registryByName).
 *   2. External `ToolProvider.list(ctx).find(...)` if a `.toolProvider()`
 *      was wired and the tool isn't in the static registry.
 *
 * Permission gate (when `permissionChecker` is configured) runs BEFORE
 * `tool.execute`. Deny → tool not executed; result is a synthetic
 * denial string. Allow / gate_open → execution proceeds.
 *
 * Gate order for one call, and why it is this order:
 *
 *   permission → MIDDLEWARE CHAIN → arg validation → check-in →
 *   credentials → execute → THE CHAIN AGAIN, BACKWARDS (`onToolResult`)
 *
 * The chain sits after the permission gate so an existing checker still
 * decides first (a denial there means no middleware runs), and before arg
 * validation so validation judges the args that will actually be sent —
 * a middleware that transformed args into something the tool's schema
 * rejects must be caught, not forwarded. A middleware answering `ask`
 * pauses on the SAME wire `checkIn` uses; the human's answer is a
 * decision, not a result, so the chain resumes and the REAL tool runs.
 *
 * The last step is the same chain walked BACKWARDS over the result, before it
 * becomes history — so the first-declared rule has the first word about the
 * call and the last word about the answer. It runs only for a call that
 * executed: everything the gates above refuse has no result to decide about.
 *
 * `read_skill` is the auto-attached activation tool — when the LLM
 * calls it with a valid Skill id, the next InjectionEngine pass
 * activates that Skill (lifetime: turn).
 */

import { codeRunsOf } from '../../codeRunnerTool.js';
import { isDevMode } from 'footprintjs';
import type { PausableHandler, TypedScope } from 'footprintjs';
import type {
  LLMMessage,
  PermissionCapability,
  PermissionChecker,
} from '../../../adapters/types.js';
import { checkerGoverns } from '../../../adapters/types.js';
import type { ContextRole } from '../../../events/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { extractSequence } from '../../../security/extractSequence.js';
import { skillTarget } from '../../../security/skillTarget.js';
import { menuOutstanding, type TurnRoute } from '../../../lib/injection-engine/routingPolicy.js';
import type { ToolProvider } from '../../../tool-providers/types.js';
import type { Credential, CredentialProvider } from '../../../identity/types.js';
import { unconfiguredCredentialProvider } from '../../../identity/types.js';
import {
  bindArtifacts,
  unconfiguredArtifacts,
  type ArtifactEventFact,
  type ToolArtifacts,
} from '../../../artifacts/capability.js';
import type { ArtifactMeta, ArtifactScope, ArtifactStore } from '../../../artifacts/types.js';
import { resolveToolWants, wantsNeedsStoreRefusal } from '../../../artifacts/wants.js';
import { PRESENT_TOOL_NAME, presentArtifact } from '../../../artifacts/present.js';
import {
  placedResultKind,
  placedToolResult,
  type ArtifactPlacement,
} from '../../../artifacts/placement.js';
import type { AuthorizationRequiredMode } from '../../../identity/consent.js';
import { CONSENT_PAUSE_KEY, consentQuestion, modelRefusal } from '../../../identity/consent.js';
import { isPauseRequest, PauseAnswerRequiredError } from '../../pause.js';
import {
  assertAskComponent,
  InvalidAskComponentError,
  type AskComponent,
} from '../../askComponent.js';
import {
  shouldCheckIn,
  isCheckInDecision,
  checkInDeclined,
  type ResolvedCheckInConfig,
  type CheckInRequest,
  type CheckInDecision,
} from '../../checkin.js';
import type { ProviderToolCache } from '../../slots/buildToolsSlot.js';
import type { Tool, ToolExecutionContext } from '../../tools.js';
import type { MemoryIdentity } from '../../../memory/identity/types.js';
import type { TeardownOptions, TeardownScope, ToolSessionTier } from '../../toolSessions.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';
import type { ToolMiddleware } from '../middleware/types.js';
import { runToolChain, runToolAfterChain, type ToolArgs } from '../middleware/runChain.js';
import { recordDecisions } from '../middleware/ledger.js';
import { noteRepeatedCall, repeatedCallLedgers } from '../repeatedCall.js';
import {
  formatToolArgIssues,
  validateToolArgs,
  type ToolArgValidationMode,
} from '../toolArgsValidation.js';
import { safeStringify } from '../validators.js';
import { capToolResult } from '../toolResultCap.js';
import { applyResultCeiling } from '../resultCeiling.js';
import {
  currentStepOf,
  pointerOf,
  readSkillStepIntro,
  skipAdvanceSentence,
  skipHoldSentence,
  skipNeedsReasonSentence,
  skipNothingActiveSentence,
  stepAdvanceSuffix,
  stepInProgress,
  SKIP_STEP_TOOL_NAME,
  type StepPlan,
  type StepPlanFor,
  type StepPointer,
} from '../../../lib/injection-engine/skillSteps.js';
import {
  readCoverageResult,
  type CoverageFacts,
  type DeclaredCoverage,
} from '../coverage/index.js';
import {
  explainStatusOnlyNearMiss,
  pruneLeases,
  readToolResultEnvelope,
  tenantOf,
  type InstructionLease,
  type PendingToolTransition,
  type ProposedEffect,
  type ReadToolResultEnvelope,
  type ToolResultStatus,
} from '../toolEffects.js';
import type { AgentState } from '../types.js';

export interface ToolCallsHandlerDeps {
  /** Map from tool name → Tool instance, built from the augmented
   *  registry (static .tool() entries + read_skill if any skills +
   *  shared skill tools). The dispatch primary lookup. */
  readonly registryByName: ReadonlyMap<string, Tool>;
  /** Optional external `.toolProvider()` for per-iteration dynamic
   *  tools (skill-scoped, multi-tenant, etc.). Consulted only when
   *  the static registry doesn't have the tool. */
  readonly externalToolProvider?: ToolProvider;
  /**
   * Cache populated by `buildToolsSlot` after each `provider.list(ctx)`
   * call this iteration. Read here to avoid a second `list()` call
   * (vital for async / network-backed providers). Same closure shared
   * within one chart build.
   */
  readonly providerToolCache?: ProviderToolCache;
  /** Optional permission gate. When present, every tool dispatch
   *  awaits `check({capability: 'tool_call', ...})` BEFORE executing.
   *  Throwing checkers are treated as deny-by-default. */
  readonly permissionChecker?: PermissionChecker;
  /** Optional credential provider (declare-and-push). When present, a tool's
   *  declared `needs` is resolved BEFORE execute and injected as `ctx.credential`;
   *  `ctx.credentials` exposes it for the pull escape hatch. */
  readonly credentialProvider?: CredentialProvider;
  /**
   * The claim-check store (9.21.0). When present, every dispatch binds it to
   * the run's scope (`scope.runIdentity` — the tuple memory scopes on) as
   * `ctx.artifacts`, with `origin` stamped from the run's own facts and every
   * mint/resolve/sweep/refusal emitted as `agentfootprint.artifacts.*`.
   * Undefined — the default — and `ctx.artifacts` is the fail-closed teacher:
   * byte-identical behavior and events (zero-cost-when-unused).
   */
  readonly artifactStore?: ArtifactStore;
  /**
   * The placement threshold (9.22.0) — the operator's ref-ing dial. When set
   * (only ever beside `artifactStore`; the Agent option's shape enforces it),
   * every finalized tool result on every dispatch path is measured, and one
   * whose text exceeds `maxInlineChars` is checked into the store (kind
   * `tool-result/<toolName>`) with the model reading the claim ticket
   * instead. Judged AFTER the tool's own `resultCeiling` and the after-tool
   * chain, BEFORE the `maxToolResultChars` truncation net. Undefined — the
   * default — and results are never measured against it (zero-cost).
   */
  readonly placement?: ArtifactPlacement;
  /** Tool-args validation mode (#9). Default 'enforce': LLM-produced args
   *  are checked against the tool's `inputSchema` BEFORE dispatch; a
   *  mismatch rejects the call with a model-visible retry message.
   *  'warn' emits the event but executes anyway; 'off' skips validation. */
  readonly toolArgValidation?: ToolArgValidationMode;
  /**
   * The opt-in ceiling on ONE tool result, in characters (9.11.0).
   *
   * Undefined — the ordinary case — means results are never measured and never
   * replaced, which is what every release before 9.11.0 did. Set, and EVERY
   * result on EVERY dispatch path in this handler is measured against it; over
   * the cap, the result the model reads and the result
   * `agentfootprint.stream.tool_end` carries are both the marker. See
   * `../toolResultCap.ts` for the shape and why it is opt-in.
   */
  readonly maxToolResultChars?: number;
  /**
   * Tell the model when it has already made this exact call and already got
   * this exact answer (9.26.0). Threaded from `AgentOptions.repeatedCallNudge`,
   * and only when the operator turned it OFF — `undefined` here means the
   * default, which is on.
   *
   * Applied at the BATCH dispatch loop only, which is where a turn's repeats
   * actually happen. The pause-resume paths deliver a call a PERSON answered
   * or approved, and a note telling the model it has already done what a human
   * just authorised would be the framework arguing with the human.
   */
  readonly repeatedCallNudge?: boolean;
  /**
   * Skill-graph read_skill GATE (`graph.reachableSkills`). When present, a
   * `read_skill('id')` whose `id` is not reachable from the current cursor is
   * REJECTED — the model gets a synthetic re-prompt naming the allowed ids and
   * the cursor/activations stay unchanged, so it can't leave the graph mid-run.
   * Undefined → no gate (plain read_skill agents append as before).
   */
  readonly allowedSkillIds?: (currentSkillId?: string) => readonly string[];
  /**
   * The OPEN skills — registered skills the graph never wires, admitted by the gate
   * from ANY cursor (8.4.0; see `Agent.openSkillIds`). They ACTIVATE and never move
   * the cursor: a skill the graph does not route is not a node, so it cannot be a
   * hop. Only meaningful alongside `allowedSkillIds`.
   */
  readonly openSkillIds?: readonly string[];
  /**
   * Is the mounted graph a decision `tree()`? Changes only the REFUSAL TEXT (8.5.0).
   *
   * A tree routes by predicate every iteration and has no cursor, so
   * `reachableSkills()` is empty and every leaf pick is refused. Told with the
   * generic message that reads "No skills are reachable from here", which is true
   * but teaches nothing — the model would keep trying. The tree-shaped message says
   * why the graph cannot be jumped at all, so the model stops asking and answers.
   */
  readonly skillGraphIsTree?: boolean;
  /**
   * The frozen step plans, keyed by skill id (9.18.0) — set only when ≥1
   * registered skill declares `steps`. This stage owns the pointer's two
   * RESULT-BOUNDARY moves, applied at EVERY site a result becomes final and
   * is pushed (the batch loop AND all the pausable resume paths — a step
   * whose tool paused, an `askHuman` step first among them, must advance on
   * the resumed call exactly as it would have inline):
   *
   *   • ADVANCE — the finalized call is the current step's tool, ran, and
   *     was not an error/denial/refusal → pointer + 1, `step_advanced`, and
   *     the model-visible result gains the "now on step k+1" suffix
   *     (composed BEFORE the history push — one past, no splicing).
   *   • SKIP — a `skip_step` call: reason validated (empty → teaching
   *     result, no event), `step_skipped` emitted, pointer moved or held
   *     per the skill's declared `onSkip`, and the model-visible result is
   *     OVERWRITTEN with the authoritative sentence (the read_skill-refusal
   *     precedent — bookkeeping lives where the batch order lives).
   *
   * Postures never gate `skip_step`: skipping is judgment INSIDE a step,
   * not routing. Undefined → no stepped skill anywhere; not one new line
   * runs (zero-cost-when-unused).
   */
  readonly stepPlanFor?: StepPlanFor;
  /**
   * The mount's routing POSTURE beyond reachability (SG-C `strictness`).
   * Undefined = `'assist'` = today's gate, byte-for-byte — not one new line
   * runs. Judged AFTER reachability (an unreachable pick keeps its original
   * teaching refusal), and only on HOPS — an OPEN skill (`.selfExplain()`,
   * a `.skill()` beside the graph) is admitted from anywhere under every
   * posture, so debugging never breaks:
   *   • `'guard'` — a routing pick is admitted only while the turn's MENU is
   *     outstanding AND names an offered id (the framework declared the
   *     ambiguity; the model resolves exactly that). Off-menu / no-menu picks
   *     get a teaching refusal + `skill.rejected { posture: 'guard' }`.
   *   • `'rails'` — routing picks are refused outright: rules/scorer resolve
   *     turn starts, declared routes handle transitions.
   * Same graph, same trace: postures change refusal behavior only.
   */
  readonly skillStrictness?: 'guard' | 'rails';
  /**
   * Escalate-on-evidence (9.19.0). When declared, the two `skill.rejected`
   * emit sites below increment a per-turn counter; at `afterRefusals` the
   * rest of the turn flips onto the escalation brain (`scope.skillEscalated`
   * — a committed fact callLLM's `brainFor` reads) and `skill.escalated`
   * goes on the record ONCE. Undefined — the default — and not one new key
   * is read or written (zero-cost-when-unused).
   */
  readonly escalation?: {
    readonly afterRefusals: number;
    /** The declared escalation brain, for the event's `to`. */
    readonly to: { readonly provider: string; readonly model?: string };
    /** Resolve the brain that WAS serving (the event's honest `from`) — the
     *  same precedence chain callLLM applies, evaluated at the flip. */
    readonly describeFrom: (
      cursor: string | undefined,
      resolvedModel: string | undefined,
    ) => { readonly provider: string; readonly model: string };
  };
  /**
   * The registered injection ids a `require-instruction` tool effect may
   * push, with the one fact its check-up needs (9.19.0): a skill whose
   * declared body channel is `'tool-only'` cannot be pushed through the
   * system slot — the slot suppresses it — so granting the lease would be
   * accepted-and-silently-undelivered. Undefined → the agent registered no
   * injections; every require-instruction is a teaching refusal.
   */
  readonly leaseTargets?: ReadonlyMap<string, { readonly surfaceMode?: string }>;
  /**
   * Check-in config (evidence-carrying human consent). Resolved from the Agent
   * builder (`.checkIn({...})`) — defaults to `standard` evidence + the
   * deterministic lexical scorer, so a tool that declares `checkIn` works even
   * without `.checkIn()`. Undefined only when the handler is built outside an
   * Agent (no check-in). The gate fires ONLY for tools that declared `checkIn`.
   */
  readonly checkIn?: ResolvedCheckInConfig;
  /**
   * The tool-dispatch governance chain (`.toolMiddleware(...)`), in
   * declaration order. Walked AFTER the permission gate — so an existing
   * `PermissionChecker` still decides first and a denial there means no
   * middleware runs at all — and BEFORE arg validation, so validation judges
   * the args that will actually be sent rather than the ones the model
   * proposed. Empty / undefined → not walked, no ledger key, no events.
   */
  readonly toolMiddleware?: readonly ToolMiddleware[];

  /**
   * The durable-write barrier (`core/durabilityBarrier.ts`). Asked ONCE per
   * iteration, before any of this iteration's tools are dispatched: if the last
   * iteration's state is still being written to a session store, wait for it.
   *
   * This is what bounds side-effect replay. Without it, iteration N's tools run
   * while iteration N-1's write is in flight, so a crash can re-issue more than
   * one iteration's worth of tool calls on replay and "how much re-executes?"
   * has no answer. With it the answer is exactly one: the current iteration.
   *
   * Returns `undefined` when nobody installed a barrier — the ordinary case —
   * and the dispatch loop then does not await at all, so an agent without a
   * durable session composer is byte-identical in behaviour AND in timing.
   *
   * NOT a general extension point: the only installer is
   * `agentfootprint/hosting`'s session writer, through a module-private
   * WeakMap that appears on no barrel. See `core/durabilityBarrier.ts`.
   *
   * @internal
   */
  readonly awaitDurable?: () => Promise<void> | undefined;
  /**
   * The identity facts THIS run carries, for `ToolExecutionContext` (9.7.0).
   *
   * An ACCESSOR, for the same reason `awaitDurable` is one: the chart is built
   * ONCE at construction and these change per run, so a captured value would be
   * run #1's forever. Read once per dispatch loop, beside `scope.runIdentity`.
   *
   * `identity` here is the CALLER's explicit identity (`Agent.lastRunIdentity`),
   * NOT `scope.runIdentity` — the latter is always populated, defaulting to
   * `{ conversationId: '<runId>' }` (or, on a session-bound run since 9.10.0,
   * to `{ conversationId: sessionId }`), and publishing either to a tool would
   * present a synthesized conversation as one somebody named.
   *
   * @internal
   */
  readonly currentRun?: () => {
    readonly runId: string;
    readonly sessionId?: string;
    readonly identity?: MemoryIdentity;
  };
  /**
   * The runner's teardown tier, created on first use (9.7.0).
   *
   * An accessor for the same reason as `currentRun`, and lazy for a second one:
   * an agent whose tools never register a cleanup must not pay for a tier, so
   * the Agent builds one the first time a tool asks.
   *
   * @internal
   */
  readonly toolSessions?: () => ToolSessionTier;
  /**
   * What to do when a tool's DECLARED credential needs 3LO consent (8.6.0).
   * Default `'pause'`. See `AgentOptions.onAuthorizationRequired`.
   */
  readonly onAuthorizationRequired?: AuthorizationRequiredMode;
  /**
   * Side channel for the `'tell-model'` consent record — the ONLY route the
   * authorization URL takes out of this handler in that mode.
   *
   * It is a callback rather than a scope key on purpose. A tracked write lands
   * in the commit log, which is the snapshot, the narrative and every
   * recording; writing the URL there would rebuild the exact leak 8.6.0
   * removes. This hands it to a private field on the Agent instead, where it
   * lives for the length of the run and leaves only as
   * `CredentialConsentRequiredError`.
   *
   * @internal
   */
  readonly reportConsentOutstanding?: (record: {
    readonly service: string;
    readonly authorizationUrl: string;
    readonly sessionId: string;
    readonly tool: string;
    readonly iteration: number;
  }) => void;
  /**
   * Clears an outstanding consent record for `service` — called whenever a
   * credential for it is successfully ISSUED. Without this, a run that was
   * blocked, resumed, and then succeeded would still raise at the end: the
   * record is about work that has since been done.
   *
   * @internal
   */
  readonly clearConsentOutstanding?: (service: string) => void;
}

/** Declaration order preserved, ids de-duplicated — the shape the gate's re-prompt
 *  and the `skill.rejected` payload both report as "what this gate accepts". */
function dedupeIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)];
}

/**
 * The constructor name of what was thrown, when what was thrown was an Error.
 *
 * Reported on `agentfootprint.credential.failed` so an alert can route on the
 * CLASS of failure rather than parse a message. `undefined` for a thrown
 * non-Error, because "Object" would be a fact about JavaScript rather than
 * about the failure.
 */
function errorClassOf(err: unknown): string | undefined {
  return err instanceof Error ? err.constructor?.name ?? err.name : undefined;
}

/**
 * Wrap the credential provider handed to a tool as `ctx.credentials`, so a
 * failure inside the tool's OWN `getCredential(...)` call is as visible as one
 * on the declared-`needs` path.
 *
 * Why this exists (9.4.0). `needs` resolution has emitted
 * `agentfootprint.credential.failed` since 6.11.0. The pull path — a tool that
 * asks for its own credential mid-execute — emitted nothing: the throw was
 * caught by the generic tool catch and became `tool_end` with `error: true`,
 * one indistinguishable failure among all the other ways a tool can fail. An
 * operator watching the credential domain saw a healthy silence while every
 * call was failing to authenticate, which is the exact shape of the AWS
 * identity-adapter bug this release fixes.
 *
 * It is a decorator, not a replacement: the same `id`, the same result, the
 * same throw. It only makes a noise on the way past.
 */
function reportingCredentials(
  provider: CredentialProvider,
  scope: TypedScope<AgentState>,
  toolName: string,
): CredentialProvider {
  return {
    id: provider.id,
    async getCredential(req) {
      try {
        return await provider.getCredential(req);
      } catch (err) {
        typedEmit(scope, 'agentfootprint.credential.failed', {
          service: req.service,
          reason: err instanceof Error ? err.message : String(err),
          tool: toolName,
          ...(errorClassOf(err) !== undefined && { errorClass: errorClassOf(err) }),
        });
        throw err;
      }
    },
  };
}

/**
 * The re-prompt a refused `read_skill` gets back. It is the model's only feedback,
 * so it names what IS allowed rather than only what isn't.
 *
 * Three shapes, because "not reachable" has three different reasons and only the
 * first two share a fix:
 *   • something is reachable → name it, and ask for one of those;
 *   • a decision `tree()` → nothing is EVER reachable by `read_skill`, because a
 *     tree has no cursor to move (8.5.0). Saying "no skills are reachable from
 *     here" would invite the model to try again from somewhere else; there is no
 *     "elsewhere", so the message explains the tree instead;
 *   • a flat graph that happens to be at a dead end → the original message.
 */
function skillRefusal(requestedId: string, allowed: readonly string[], isTree: boolean): string {
  const head = `read_skill("${requestedId}") is not reachable from here. `;
  if (allowed.length > 0) {
    return `${head}Reachable skills: ${allowed.join(', ')}. Pick one of these, or finish.`;
  }
  if (isTree) {
    return (
      `read_skill("${requestedId}") cannot move a decision tree. A tree routes by ` +
      'predicate on every iteration — it has no cursor to jump, so this skill would ' +
      'not activate even though the tool accepted the name. Answer with the skill the ' +
      'tree routed to, or finish.'
    );
  }
  return `${head}No skills are reachable from here — answer with the current skill, or finish.`;
}

/**
 * The re-prompt a POSTURE-refused `read_skill` gets back (SG-C `strictness`).
 * The pick was REACHABLE — the graph would have granted it — so the message
 * must teach the posture, not the map: who routes here, and what the model may
 * still do (open skills, staying, finishing).
 */
function postureRefusal(
  requestedId: string,
  posture: 'guard' | 'rails',
  turnRoute: TurnRoute | undefined,
  currentSkillId: string | undefined,
  openIds: readonly string[],
): string {
  const openClause =
    openIds.length > 0
      ? ` read_skill here reaches only the open skills: ${openIds.join(', ')}.`
      : '';
  if (posture === 'rails') {
    return (
      `read_skill("${requestedId}") was declined: this graph runs on rails — turn starts ` +
      `resolve by declared rule or scorer and transitions by declared routes; the model ` +
      `does not route itself.${openClause} Continue with the skill you are in` +
      `${currentSkillId !== undefined ? ` ('${currentSkillId}')` : ''}, or finish.`
    );
  }
  // guard — either no menu is outstanding, or the pick was off it.
  if (turnRoute?.offered !== undefined && menuOutstanding(turnRoute, currentSkillId)) {
    return (
      `read_skill("${requestedId}") was declined: under this graph's 'guard' posture a ` +
      `routing pick must come from the offered menu — ${turnRoute.offered.join(', ')} — or ` +
      `stay (answer without calling read_skill).${openClause}`
    );
  }
  const decidedBy =
    turnRoute?.by === 'intent' || turnRoute?.by === 'entry'
      ? `the turn's start was resolved decisively this turn`
      : `no routing ambiguity is open this turn`;
  return (
    `read_skill("${requestedId}") was declined: this graph's 'guard' posture admits a ` +
    `routing pick only while the framework has declared ambiguity (an offered menu), and ` +
    `${decidedBy}; declared routes handle transitions.${openClause} Continue with the ` +
    `skill you are in${currentSkillId !== undefined ? ` ('${currentSkillId}')` : ''}, or finish.`
  );
}

/**
 * The args a `pauseHere` / `askHuman` call was running with, read back on the
 * far side of the pause (8.13.0).
 *
 * Normally `scope.pausedToolArgs`: written at pause time from `callArgs`, so it
 * is the post-transform args `ToolResultContext.args` promises.
 *
 * A checkpoint written BEFORE 8.13.0 does not carry the field — a real case
 * during a rolling deploy. Those args are recovered from the assistant turn in
 * `history` by `toolCallId`: real values the model proposed, identical to the
 * running args unless a before-tool middleware transformed them, and that one
 * difference is not recoverable from a checkpoint that never recorded it.
 *
 * `{}` is the last resort and only when the turn is gone (a window strategy
 * folded it away). It is returned rather than skipping the after-tool moment,
 * because a rule that never runs is the bug this release is fixing — but it is
 * genuinely "we do not know", never a claim that the tool ran with none.
 */
function argsForPausedCall(
  scope: TypedScope<AgentState>,
  toolCallId: string,
): Readonly<Record<string, unknown>> {
  const carried = scope.pausedToolArgs as Readonly<Record<string, unknown>> | undefined;
  if (carried !== undefined) return { ...carried };
  for (const message of scope.history as readonly LLMMessage[]) {
    for (const call of message.toolCalls ?? []) {
      if (call.id === toolCallId) return { ...call.args };
    }
  }
  return {};
}

/**
 * Build the pausable tool-call handler for the agent's chart.
 */
/**
 * Append one landed result to the iteration's tool-result batch (9.16.0).
 *
 * The execute path resets `scope.toolResults` before its dispatch loop and
 * appends per call; the four RESUME paths go through here instead — the
 * paused iteration's partial batch (every sibling that ran before the pause)
 * is already committed on scope, and the answered call joins it in call
 * order rather than erasing it. Spread first: a TypedScope array read is a
 * live proxy view, and the batch must stay plain data.
 */
function appendBatchResult(
  scope: TypedScope<AgentState>,
  entry: { toolName: string; result: string; toolCallId: string; status?: ToolResultStatus },
): void {
  scope.toolResults = [...(scope.toolResults ?? []), entry];
}

/**
 * The ledger key for a handler built with no `currentRun` accessor — a
 * hand-composed dispatch loop in a test, never an Agent (which always wires
 * it).
 *
 * One shared bucket, stated rather than hidden: without a run id there is
 * nothing to tell two runs apart by, and the honest consequence is that such a
 * loop counts across them. It cannot leak anything — the ledger holds
 * fingerprints — and the only visible effect is a note arriving one call early.
 */
const UNSCOPED_RUN = '#no-run-id';

export function buildToolCallsHandler(
  deps: ToolCallsHandlerDeps,
): PausableHandler<TypedScope<AgentState>> {
  const { registryByName, externalToolProvider, providerToolCache, permissionChecker } = deps;
  const toolArgValidation = deps.toolArgValidation ?? 'enforce';
  // 8.6.0 — default `'pause'`. Consent is work waiting on a person, and every
  // other place this library needs a person stops the run and asks the caller.
  const onAuthorizationRequired: AuthorizationRequiredMode =
    deps.onAuthorizationRequired ?? 'pause';
  // Fail-closed: when no provider is attached, `ctx.credentials` is a provider
  // that THROWS on use (never undefined) — so a tool can't silently no-op.
  const credentials = deps.credentialProvider ?? unconfiguredCredentialProvider();
  const hasCredentials = deps.credentialProvider !== undefined;
  // The repeated-call counters (9.26.0), run-keyed and OFF tracked scope — an
  // empty Map here, and not one byte written anywhere a reader can see until a
  // tool actually lands. See `../repeatedCall.ts` for why they are not state.
  const repeatLedgers = repeatedCallLedgers();

  /**
   * The tool-result ceiling, applied at the ONE place a result leaves dispatch.
   *
   * Both channels are measured SEPARATELY and on purpose. `result` is the
   * tool's own truth and is what `stream.tool_end` reports; `modelResult` is
   * what an `onToolResult` rule let the model read, and a rule that summarized
   * a huge result down to a paragraph should not then be told it was
   * truncated. Measuring each against the same cap keeps every channel honest
   * about what IT is carrying — and stops a capped run from shipping the very
   * payload it capped to an event sink.
   *
   * Absent cap → both values come back by reference, so an agent that did not
   * ask for a ceiling is byte-identical.
   */
  const capResults = (
    toolName: string,
    values: { readonly result: unknown; readonly modelResult: unknown },
  ): { readonly result: unknown; readonly modelResult: unknown } => {
    const max = deps.maxToolResultChars;
    if (max === undefined) return values;
    const result = capToolResult(values.result, { toolName, maxChars: max }).value;
    return {
      result,
      // One marker when the two channels carry one value — the common case, and
      // the one where two distinct objects would be a difference with no fact
      // behind it.
      modelResult:
        values.modelResult === values.result
          ? result
          : capToolResult(values.modelResult, { toolName, maxChars: max }).value,
    };
  };

  /**
   * The tool's OWN refusing ceiling (9.20.0) — ONE implementation for every
   * dispatch door, applied at the execute boundary the moment the handler's
   * return lands (BEFORE the after-tool chain, the read_skill-gate precedent:
   * governance composes over what the model will actually read).
   *
   * `undefined` = no ceiling declared or the result fits — the caller keeps
   * today's path byte for byte. Otherwise: the typed `tools.result_refused`
   * event records the true size (the only place it survives), and the returned
   * TEACHING REFUSAL replaces the payload on every channel — history,
   * `stream.tool_end`, recorders. Distinct from the agent-level
   * `maxToolResultChars` (which truncates with a verbatim head, measured AFTER
   * the chain): this is the tool author's own contract, and the two compose —
   * the refusal sentence is far under any sane agent cap.
   */
  const refuseOverCeiling = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    tool: Tool | undefined,
    value: unknown,
    declaredStatus?: ToolResultStatus,
  ): string | undefined => {
    const ceiling = tool?.resultCeiling;
    const verdict = applyResultCeiling(value, { toolName: call.toolName, ceiling });
    if (verdict === undefined || ceiling === undefined) return undefined;
    typedEmit(scope, 'agentfootprint.tools.result_refused', {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      sizeChars: verdict.sizeChars,
      maxChars: ceiling.maxChars,
      // Copied — event payloads are detached plain data, never shared refs.
      ...(ceiling.narrowBy !== undefined && { narrowBy: [...ceiling.narrowBy] }),
      ...(declaredStatus !== undefined && { declaredStatus }),
    });
    return verdict.refusal;
  };

  /**
   * Coverage declarations — `absent(…)` and `coverage(…)`, recognized at the
   * SAME execute boundaries the ceiling is measured at (one implementation,
   * every door: a resumed call declares its coverage exactly as an inline
   * one).
   *
   * Returns the DELIVERED status: `'absent'` when an absence is in play,
   * `undefined` otherwise. That single line is the whole downstream
   * behavioural change, and it is deliberately narrow — an absence is not an
   * error, so nothing here sets `error: true`, nothing refuses, nothing
   * retries, and the value the model reads is the value the tool minted. The
   * direction-of-error argument (see `../coverage/absent.ts`) is that a
   * *nothing-found* routed as a *failure* sends someone to investigate a
   * healthy collector, while a *failure* routed as *nothing-found* declares a
   * system fine that was never checked; giving the outcome its own word is
   * how `onToolStatus` edges stop having to guess.
   *
   * The RECORD keeps the coverage twice over: on the emit channel (per-call
   * facts belong there) and, because a limit is a fact about the ANSWER
   * rather than about an attempt, in tracked state — where the final-answer
   * block reads it. Written only when a tool declares one, so an agent that
   * returns neither shape commits exactly what it always did.
   */
  const declareCoverage = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    value: unknown,
  ): ToolResultStatus | undefined => {
    const reading = readCoverageResult(value);
    if (reading === undefined) return undefined;
    const rows: DeclaredCoverage[] = [];
    for (const facts of reading.declared) {
      // Copied item by item — event payloads are detached plain data, never
      // a shared reference into a value the tool still holds.
      const copy = (list: CoverageFacts['coverage']['checked']) =>
        list.map((i) => ({ what: i.what, ...(i.why !== undefined && { why: i.why }) }));
      const checked = copy(facts.coverage.checked);
      const notChecked = copy(facts.coverage.notChecked);
      const cannotCover = copy(facts.coverage.cannotCover);
      if (facts.kind === 'absence') {
        typedEmit(scope, 'agentfootprint.tools.absent', {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
          checked,
          ...(notChecked.length > 0 && { notChecked }),
          ...(cannotCover.length > 0 && { cannotCover }),
        });
      } else {
        typedEmit(scope, 'agentfootprint.tools.coverage_declared', {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          ...(checked.length > 0 && { checked }),
          ...(notChecked.length > 0 && { notChecked }),
          ...(cannotCover.length > 0 && { cannotCover }),
        });
      }
      rows.push({
        kind: facts.kind,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        ...(facts.lookedFor !== undefined && { lookedFor: facts.lookedFor }),
        checked,
        notChecked,
        cannotCover,
      });
    }
    scope.coverageDeclared = [...(scope.coverageDeclared ?? []), ...rows];
    return reading.status;
  };

  // ── Step-procedure boundary (9.18.0) — ONE implementation, five sites ──
  // The batch loop and the four resume paths all finalize results; each
  // calls these where its result becomes final, so a pointer can never miss
  // a move because of which door the result came through (the resume-path
  // law: the checkpoint carries the pointer for free in sharedState, and
  // the answered call advances it HERE on resume).

  /** The in-progress procedure, when there is one: pointer + plan + the
   *  current step. Undefined on every agent without steps, between tenures,
   *  and once a procedure completed. */
  const stepStateOf = (
    scope: TypedScope<AgentState>,
  ): { ptr: StepPointer; plan: StepPlan; step: { tool: string; note: string } } | undefined => {
    if (!deps.stepPlanFor) return undefined;
    const ptr = pointerOf(scope.stepPointer);
    if (!stepInProgress(ptr)) return undefined;
    const plan = deps.stepPlanFor(ptr.skillId);
    if (!plan) return undefined;
    const step = currentStepOf(ptr, plan);
    return step ? { ptr, plan, step } : undefined;
  };

  /**
   * `skip_step` bookkeeping — returns the AUTHORITATIVE result that
   * replaces the tool's placeholder (both channels, the read_skill-refusal
   * precedent). Emits `step_skipped` and moves/holds the pointer per the
   * declared policy; a teaching answer (no active procedure / empty
   * reason) emits nothing.
   */
  const applySkipStep = (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ): string => {
    const state = stepStateOf(scope);
    if (!state) return skipNothingActiveSentence();
    const raw = (call.args as { reason?: unknown }).reason;
    const reason = typeof raw === 'string' ? raw.trim() : '';
    if (reason.length === 0) return skipNeedsReasonSentence();
    const { ptr, plan, step } = state;
    typedEmit(scope, 'agentfootprint.skill.step_skipped', {
      skillId: ptr.skillId,
      step: { index: ptr.step, total: ptr.total, tool: step.tool, note: step.note },
      reason,
      policy: plan.onSkip,
      iteration: call.iteration,
      toolCallId: call.toolCallId,
    });
    // 'hold': recorded and held — the step stays the offer; repeated skips
    // of a held step are each recorded, because each is a fact.
    if (plan.onSkip === 'hold') return skipHoldSentence(ptr, reason, plan);
    const next: StepPointer = {
      skillId: ptr.skillId,
      step: ptr.step + 1,
      total: ptr.total,
      skipped: [...ptr.skipped, ptr.step],
    };
    scope.stepPointer = [next];
    return skipAdvanceSentence(ptr.step, reason, next, plan);
  };

  /**
   * Advance-on-return — the caller has just finalized a NON-error,
   * NON-denied, NON-refused result for `toolName`. When that call is the
   * current step's tool: pointer + 1, `step_advanced` (with `completed` on
   * the last), and the returned suffix joins the model-visible result
   * BEFORE the history push. Empty string otherwise. Eligibility (ran,
   * not denied/rejected/errored) is judged by the CALLING site, because
   * each dispatch path knows its own truth about that.
   */
  const applyStepReturn = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  ): string => {
    const state = stepStateOf(scope);
    if (!state || state.step.tool !== call.toolName) return '';
    const { ptr, plan, step } = state;
    const next: StepPointer = {
      skillId: ptr.skillId,
      step: ptr.step + 1,
      total: ptr.total,
      skipped: [...ptr.skipped],
    };
    scope.stepPointer = [next];
    const completed = next.step > next.total;
    typedEmit(scope, 'agentfootprint.skill.step_advanced', {
      skillId: ptr.skillId,
      step: { index: ptr.step, total: ptr.total, tool: step.tool, note: step.note },
      iteration: call.iteration,
      toolCallId: call.toolCallId,
      ...(completed && { completed: true as const }),
    });
    return stepAdvanceSuffix(next, plan);
  };

  /** The `read_skill` activation intro for a STEPPED skill — where its
   *  procedure starts. Rides the same "activated for the next iteration"
   *  promise the read_skill result already makes (a same-batch declared
   *  edge that outruns the pick reports itself via `reroute_superseded`,
   *  exactly as it does for the activation sentence). */
  const readSkillStepIntroFor = (pickedId: string): string => {
    const plan = deps.stepPlanFor?.(pickedId);
    return plan ? readSkillStepIntro(plan) : '';
  };

  // ── Escalate-on-evidence (9.19.0) — the refusal budget ─────────────────
  // Called beside BOTH `skill.rejected` emit sites (reachability + posture):
  // real recorded refusals are the only evidence that counts. At the
  // declared threshold the flip is committed (`skillEscalated` — the fact
  // callLLM's brainFor reads) and `skill.escalated` fires ONCE; the counter
  // keeps counting so the record shows the whole loop. Gated on the policy
  // being declared — otherwise not one key is read or written.
  const noteSkillRefusal = (scope: TypedScope<AgentState>, iteration: number): void => {
    const escalation = deps.escalation;
    if (!escalation) return;
    const refusals = ((scope.skillRefusalsThisTurn as number | undefined) ?? 0) + 1;
    scope.skillRefusalsThisTurn = refusals;
    if (refusals >= escalation.afterRefusals && scope.skillEscalated !== true) {
      scope.skillEscalated = true;
      typedEmit(scope, 'agentfootprint.skill.escalated', {
        iteration,
        afterRefusals: escalation.afterRefusals,
        refusals,
        from: escalation.describeFrom(
          scope.currentSkillId as string | undefined,
          scope.resolvedModel as string | undefined,
        ),
        to: escalation.to,
      });
    }
  };

  // ── Typed tool effects (9.19.0) — ONE judge, every dispatch path ───────
  // The batch loop and the resume paths all finalize results; each hands a
  // recognized envelope here, so an effect can never be judged differently
  // because of which door its result came through.

  /** The batch's transition bookkeeping: first ACCEPTED proposal wins the
   *  one `pendingToolTransition` slot (committed at acceptance, so a pause
   *  mid-batch never drops an accepted move); later proposals to OTHER
   *  targets are suppressed + collected for the batch-end `route_conflict`
   *  aggregate. */
  interface TransitionBatchState {
    winner?: PendingToolTransition;
    losers: Array<{ toolCallId?: string; toolName: string; target: string }>;
  }

  const warnEffect = (toolName: string, sentence: string): void => {
    if (isDevMode()) {
      // eslint-disable-next-line no-console
      console.warn(`agentfootprint tool-effects: tool '${toolName}' — ${sentence}`);
    }
  };

  /**
   * Judge one finalized result's effects, in declaration order. Returns the
   * model-visible NOTE (teaching refusals only — an accepted effect speaks
   * through what it does: the cursor move, the delivered instruction).
   * Every judgment is a `tools.effect` event; nothing is half-applied.
   */
  const applyToolEffects = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    envelope: ReadToolResultEnvelope,
    state: TransitionBatchState,
  ): string => {
    let note = '';
    const refuse = (
      kind: ProposedEffect['kind'],
      refusalReason: string,
      fields: {
        targetSkillId?: string;
        reason?: string;
        instructionId?: string;
        deliveryLease?: InstructionLease['deliveryLease'];
      } = {},
    ): void => {
      typedEmit(scope, 'agentfootprint.tools.effect', {
        kind,
        outcome: 'refused',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        ...(fields.targetSkillId !== undefined && { targetSkillId: fields.targetSkillId }),
        ...(fields.reason !== undefined && { reason: fields.reason }),
        ...(fields.instructionId !== undefined && { instructionId: fields.instructionId }),
        ...(fields.deliveryLease !== undefined && { deliveryLease: fields.deliveryLease }),
        refusalReason,
      });
      note += ` [tool effect refused: ${refusalReason}]`;
      warnEffect(call.toolName, refusalReason);
    };

    for (const bad of envelope.malformed) refuse(bad.kind, bad.refusalReason);

    for (const effect of envelope.effects) {
      if (effect.kind === 'propose-transition') {
        const target = effect.targetSkillId;
        if (!deps.allowedSkillIds) {
          refuse(
            'propose-transition',
            `propose-transition → '${target}' needs a mounted skill graph: without one there ` +
              `is no routing law to check the proposal against and no cursor to move. Mount ` +
              `.skillGraph(), or drop the effect.`,
            { targetSkillId: target, reason: effect.reason },
          );
          continue;
        }
        const currentSkillId = scope.currentSkillId as string | undefined;
        const hops = deps.allowedSkillIds(currentSkillId);
        if (!hops.includes(target)) {
          refuse(
            'propose-transition',
            `propose-transition → '${target}' was refused: '${target}' is not reachable from ` +
              `${currentSkillId !== undefined ? `'${currentSkillId}'` : 'the turn start'} per ` +
              `the graph's own law${
                hops.length > 0 ? ` (reachable: ${hops.join(', ')})` : ''
              }. The graph decides — a proposal is evidence, never authority.`,
            { targetSkillId: target, reason: effect.reason },
          );
          continue;
        }
        if (state.winner !== undefined && state.winner.targetSkillId !== target) {
          // A later proposal to a DIFFERENT target — suppressed under the
          // route_conflict law (first in call order wins), on the record.
          state.losers.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            target,
          });
          typedEmit(scope, 'agentfootprint.tools.effect', {
            kind: 'propose-transition',
            outcome: 'superseded',
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            iteration: call.iteration,
            targetSkillId: target,
            reason: effect.reason,
            supersededBy: 'earlier-proposal',
          });
          continue;
        }
        if (state.winner === undefined) {
          state.winner = {
            targetSkillId: target,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            reason: effect.reason,
            iteration: call.iteration,
          };
          // Committed AT ACCEPTANCE (not batch end) so a pause later in the
          // batch checkpoints the accepted move instead of dropping it.
          scope.pendingToolTransition = state.winner;
          // The activation promise a gate-accepted read_skill pick makes,
          // made here too: a model-edge-only target keeps its llm-activated
          // trigger, so the ledger entry is what makes the body actually
          // load when the cursor lands.
          const activated = scope.activatedInjectionIds as readonly string[];
          if (!activated.includes(target)) {
            scope.activatedInjectionIds = [...activated, target];
          }
        }
        // First acceptance AND a same-target repeat both land here: every
        // proposal that asked for the move that happens is 'accepted'.
        typedEmit(scope, 'agentfootprint.tools.effect', {
          kind: 'propose-transition',
          outcome: 'accepted',
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          targetSkillId: target,
          reason: effect.reason,
        });
        continue;
      }
      // require-instruction
      const known = deps.leaseTargets?.get(effect.instructionId);
      if (known === undefined) {
        refuse(
          'require-instruction',
          `require-instruction '${effect.instructionId}' was refused: no registered ` +
            `injection carries that id — the push door serves the declared catalog only ` +
            `(read_skill stays the pull door).`,
          { instructionId: effect.instructionId, deliveryLease: effect.deliveryLease },
        );
        continue;
      }
      if (known.surfaceMode === 'tool-only') {
        refuse(
          'require-instruction',
          `require-instruction '${effect.instructionId}' was refused: that skill declares ` +
            `surfaceMode 'tool-only', whose body travels only as a read_skill result — the ` +
            `system slot suppresses it, so the lease would be granted and never delivered. ` +
            `Pull it with read_skill, or change the skill's surfaceMode.`,
          { instructionId: effect.instructionId, deliveryLease: effect.deliveryLease },
        );
        continue;
      }
      const tenant = tenantOf(
        scope.currentSkillId as string | undefined,
        scope.activatedInjectionIds as readonly string[] | undefined,
      );
      const lease: InstructionLease = {
        instructionId: effect.instructionId,
        deliveryLease: effect.deliveryLease,
        ...(tenant !== undefined && { skillId: tenant }),
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
      };
      // Prune-as-we-write: spent grants leave with the same write that adds
      // the new one, so a long turn never accumulates dead leases.
      scope.instructionLeases = [
        ...pruneLeases(
          scope.instructionLeases as readonly InstructionLease[] | undefined,
          call.iteration,
          tenant,
        ),
        lease,
      ];
      typedEmit(scope, 'agentfootprint.tools.effect', {
        kind: 'require-instruction',
        outcome: 'accepted',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        instructionId: effect.instructionId,
        deliveryLease: effect.deliveryLease,
      });
    }
    return note;
  };

  /** The batch-end aggregate for conflicting proposals — the
   *  `route_conflict` reuse, additive `source` says what conflicted. The
   *  per-effect `tools.effect` events above already carried every fact;
   *  this is the one-event-per-batch view the edge law already ships. */
  const emitTransitionConflict = (
    scope: TypedScope<AgentState>,
    iteration: number,
    state: TransitionBatchState,
  ): void => {
    if (state.winner === undefined || state.losers.length === 0) return;
    typedEmit(scope, 'agentfootprint.skill.route_conflict', {
      iteration,
      ...(scope.currentSkillId !== undefined && {
        fromSkillId: scope.currentSkillId as string,
      }),
      winner: {
        ...(state.winner.toolCallId !== undefined && { toolCallId: state.winner.toolCallId }),
        toolName: state.winner.toolName,
        target: state.winner.targetSkillId,
      },
      losers: state.losers.map((l) => ({ ...l })),
      source: 'tool-proposal',
    });
  };

  /**
   * Every teardown scope an Agent run can honour (9.7.0).
   *
   * All four are real here and each has a firing site: `'call'` in this loop,
   * `'run'` at `Agent.run`'s non-pause terminals, `'session'` at
   * `agent.closeToolSessions(...)`, `'shutdown'` at `agent.shutdown()`. A door
   * that cannot honour one declares a shorter list rather than accepting the
   * registration and never firing it.
   */
  const AGENT_TEARDOWN_SCOPES: readonly TeardownScope[] = ['call', 'run', 'session', 'shutdown'];

  /**
   * The identity + teardown half of a `ToolExecutionContext`.
   *
   * Built per call, from the run accessor rather than from a captured value.
   * Every field is ABSENT when the fact is absent: a tool branching on
   * `ctx.sessionId` must be able to tell "not session-bound" from "bound to
   * something I made up".
   */
  const sessionContext = (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ): Pick<
    ToolExecutionContext,
    'runId' | 'sessionId' | 'identity' | 'onTeardown' | 'teardownScopes'
  > => {
    const facts = deps.currentRun?.();
    return {
      ...(facts?.runId !== undefined && { runId: facts.runId }),
      ...(facts?.sessionId !== undefined && { sessionId: facts.sessionId }),
      ...(facts?.identity !== undefined && { identity: facts.identity }),
      teardownScopes: AGENT_TEARDOWN_SCOPES,
      onTeardown: (cleanup: () => void | Promise<void>, options?: TeardownOptions): void => {
        const scopeAsked = options?.scope ?? 'run';
        if (!AGENT_TEARDOWN_SCOPES.includes(scopeAsked)) {
          // Named, not swallowed: an accepted registration that can never fire
          // is a leaked resource wearing the shape of a tidy one.
          throw new Error(
            `tool '${toolName}': onTeardown scope '${scopeAsked}' is not honoured here. ` +
              `This door supports: ${AGENT_TEARDOWN_SCOPES.join(', ')}. ` +
              'Read `ctx.teardownScopes` and pick one of those.',
          );
        }
        const tier = deps.toolSessions?.();
        if (!tier) return;
        const filed = tier.register(
          {
            tool: toolName,
            toolCallId,
            ...(facts?.runId !== undefined && { runId: facts.runId }),
            ...(facts?.sessionId !== undefined && { sessionId: facts.sessionId }),
          },
          cleanup,
          options,
        );
        // Emitted HERE, not from the tier, because here there is still a stage
        // to be stamped with: a start and a reuse happen inside `tool.execute`,
        // so they ride the ordinary scope channel and carry the real
        // `runtimeStageId`. Only the CLOSE fires after the last stage
        // committed, and only that one wears the `tool-teardown#0` pseudo-stage.
        //
        // `keyHash`, never the key: the key composes tenant, principal and the
        // hosting sessionId, and publishing it would put a user identifier into
        // every exporter's payload.
        typedEmit(
          scope,
          filed.outcome === 'started'
            ? 'agentfootprint.tools.session_started'
            : 'agentfootprint.tools.session_reused',
          {
            tool: toolName,
            scope: scopeAsked,
            keyHash: filed.keyHash,
            ...(options?.runnerId !== undefined && { runnerId: options.runnerId }),
            ...(options?.label !== undefined && { label: options.label }),
            ...(filed.outcome === 'reused' && { calls: filed.calls }),
          },
        );
      },
    };
  };

  /**
   * `ctx.progress` for one dispatch (9.52.0) — the tool's mid-call report.
   *
   * The whole feature is this closure. A tool call is atomic on the record
   * (`tool_start`, then silence for as long as the handler runs, then
   * `tool_end`), and a twelve-hop walk spends forty seconds there with nothing
   * to show. `progress` breaks the silence over the channel already built for
   * it: `typedEmit` mid-stage, so each report carries the real
   * `runtimeStageId`, rides the `agentfootprint.stream.` prefix the EmitBridge
   * already forwards, and lands in recordings with the rest of the run.
   *
   * The three identity facts are stamped HERE, from the dispatch this closure
   * was built for — the tool sends only its own payload. A report that could
   * name its own `toolCallId` could name somebody else's, and a correlation id
   * a consumer cannot trust is worse than none.
   *
   * NEVER fatal: an emit that throws (a recorder that dies at the wrong moment,
   * a scope past its stage) must not fail a tool call that is otherwise
   * succeeding — telemetry is not the work. Named in dev mode rather than
   * swallowed, and once per tool: a twelve-hop walk whose channel is broken
   * would otherwise print twelve identical warnings per call.
   */
  const progressWarned = new Set<string>();
  const toolProgress = (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ): Pick<ToolExecutionContext, 'progress'> => ({
    progress: (payload: unknown): void => {
      try {
        typedEmit(scope, 'agentfootprint.stream.tool_progress', {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          iteration: call.iteration,
          payload,
        });
      } catch (err) {
        if (isDevMode() && !progressWarned.has(call.toolName)) {
          progressWarned.add(call.toolName);
          // eslint-disable-next-line no-console
          console.warn(
            `[agentfootprint] tool '${call.toolName}': ctx.progress could not file a report ` +
              `(${err instanceof Error ? err.message : String(err)}). The call itself is ` +
              'unaffected — progress is telemetry, and a dropped report never fails a tool.',
          );
        }
      }
    },
  });

  /**
   * `ctx.artifacts` + `ctx.hasArtifacts` for one dispatch — the claim-check
   * capability, shaped exactly like `ctx.credentials` (9.21.0).
   *
   * The SCOPE is `scope.runIdentity` — the tuple the seed stage committed and
   * memory already scopes on (an anonymous run isolates to its own runId, a
   * session-bound run to its sessionId, an identity-carrying run to the
   * caller's tenant/principal). Composed HERE, where the tool cannot reach:
   * the capability closes over it, so a ref alone opens nothing and a tool
   * can never widen the scope it resolves under. Detached to a plain object
   * so the store never holds a live scope proxy.
   *
   * Every fact the capability reports rides the ordinary emit channel via
   * `typedEmit`, mid-stage, carrying the real runtimeStageId — collected
   * during traversal, exactly like `credential.failed`. Payload bytes never
   * enter an event; the facts are meta only.
   *
   * With NO store attached the capability is the fail-closed teacher and no
   * runIdentity read happens — a storeless agent's trace stays byte-identical.
   */
  const toolArtifacts = (
    scope: TypedScope<AgentState>,
    toolName: string,
    toolCallId: string,
  ): Pick<ToolExecutionContext, 'artifacts' | 'hasArtifacts'> => {
    const onEvent = (fact: ArtifactEventFact): void => {
      switch (fact.type) {
        case 'minted': {
          const meta = fact.meta;
          typedEmit(scope, 'agentfootprint.artifacts.minted', {
            ref: meta.ref,
            kind: meta.kind,
            mediaType: meta.mediaType,
            bytes: meta.bytes,
            ...(meta.label !== undefined && { label: meta.label }),
            ...(meta.digest !== undefined && { digest: meta.digest }),
            ...(meta.expiresAt !== undefined && { expiresAt: meta.expiresAt }),
            ...(meta.origin !== undefined && { origin: meta.origin }),
            ...(meta.parentRefs !== undefined && { parentRefs: meta.parentRefs }),
            tool: toolName,
          });
          return;
        }
        case 'resolved':
          typedEmit(scope, 'agentfootprint.artifacts.resolved', {
            ref: fact.ref,
            via: fact.via,
            kind: fact.kind,
            bytes: fact.bytes,
            tool: toolName,
          });
          return;
        case 'expired':
          typedEmit(scope, 'agentfootprint.artifacts.expired', {
            ref: fact.swept.ref,
            reason: fact.swept.reason,
            kind: fact.swept.kind,
            bytes: fact.swept.bytes,
            tool: toolName,
          });
          return;
        case 'refused':
          typedEmit(scope, 'agentfootprint.artifacts.refused', {
            op: fact.op,
            reason: fact.reason,
            ...(fact.ref !== undefined && { ref: fact.ref }),
            ...(fact.detail !== undefined && { detail: fact.detail }),
            tool: toolName,
          });
          return;
      }
    };
    const store = deps.artifactStore;
    if (store === undefined) {
      return { artifacts: unconfiguredArtifacts(onEvent), hasArtifacts: false };
    }
    const facts = deps.currentRun?.();
    const artifacts: ToolArtifacts = bindArtifacts(store, runScopeOf(scope), {
      origin: { ...(facts?.runId !== undefined && { runId: facts.runId }), toolCallId },
      onEvent,
    });
    return { artifacts, hasArtifacts: true };
  };

  /**
   * The run's artifact scope — `scope.runIdentity`, detached to a plain
   * object so no store or resolver ever holds a live scope proxy. ONE
   * composition shared by the capability binding, `wants` resolution,
   * `present`, and placement: four doors, one isolation rule, no drift.
   */
  const runScopeOf = (scope: TypedScope<AgentState>): ArtifactScope => {
    const identity = scope.runIdentity;
    return {
      conversationId: identity.conversationId,
      ...(identity.tenant !== undefined && { tenant: identity.tenant }),
      ...(identity.principal !== undefined && { principal: identity.principal }),
    };
  };

  // ── Ref ARGUMENTS at dispatch (9.22.0, Leg 1) — ONE resolver, every door ──
  // The batch loop and `resolveCredentialAndExecute` (the resume paths) both
  // dispatch tools; each calls this BEFORE credential resolution — never
  // acquire credentials for a call that won't run — so a declared ref is
  // judged identically whichever door the call came through. Success rides
  // the existing `artifacts.resolved` (one event per resolved argument);
  // refusals ride `artifacts.refused` with `op: 'dispatch'`, and the tool is
  // NOT executed — the model reads the teaching refusal instead.

  const resolveWantsAtDispatch = async (
    scope: TypedScope<AgentState>,
    toolName: string,
    wants: NonNullable<Tool['wants']>,
    args: ToolArgs,
    /** The tool's OWN schema — the other half of the declaration. `required`
     *  there is what makes an omitted ref a hole rather than a choice, and it
     *  is read HERE, not left to `toolArgValidation`: that dial is agent-wide
     *  and can be turned off, while `wants` is a promise about delivered data
     *  (the same reason the non-string belt already runs behind a disabled
     *  gate). */
    inputSchema: Readonly<Record<string, unknown>> | undefined,
  ): Promise<
    | {
        readonly ok: true;
        readonly args: ToolArgs;
        readonly wanted?: Readonly<Record<string, ArtifactMeta>>;
      }
    | { readonly ok: false; readonly refusal: string }
  > => {
    const store = deps.artifactStore;
    if (store === undefined) {
      // Statically registered tools are refused at BUILD; this serves the
      // doors that only meet the tool at dispatch (provider-served tools).
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'no-store',
        detail: `tool '${toolName}' declares wants but no artifact store is attached`,
        tool: toolName,
      });
      return { ok: false, refusal: wantsNeedsStoreRefusal(toolName, wants) };
    }
    const verdict = await resolveToolWants(
      store,
      runScopeOf(scope),
      toolName,
      wants,
      args,
      inputSchema,
    );
    if (!verdict.ok) {
      for (const refusal of verdict.refusals) {
        typedEmit(scope, 'agentfootprint.artifacts.refused', {
          op: 'dispatch',
          reason: refusal.reason,
          ...(refusal.ref !== undefined && { ref: refusal.ref }),
          detail: refusal.detail,
          tool: toolName,
        });
      }
      return { ok: false, refusal: verdict.refusal };
    }
    for (const { meta } of verdict.resolved) {
      typedEmit(scope, 'agentfootprint.artifacts.resolved', {
        ref: meta.ref,
        via: 'get',
        kind: meta.kind,
        bytes: meta.bytes,
        tool: toolName,
      });
    }
    return {
      ok: true,
      args: verdict.args,
      // Absent when nothing resolved (no declared arg was passed): absent
      // and empty are different facts, and `ctx.wanted` keeps them apart.
      ...(verdict.resolved.length > 0 && { wanted: verdict.wanted }),
    };
  };

  // ── Typed-HITL ask components at raise time (9.24.0) ───────────────────
  // The ONE gatekeeper every component-carrying ask passes through before it
  // is allowed to pause: `askHuman({ component })`, a middleware `ask`, and a
  // tool's `checkInComponent` all land here. Shape first (the door the value
  // arrived through is named in the refusal), then the `propsRef` questions
  // only a raise site can answer — is there a store, and does the ref resolve
  // in THIS run's scope. A dangling ref is refused at its source, loudly (the
  // run fails with the teaching error), never handed to a screen to discover:
  // a pause whose component cannot render is a question a person
  // half-receives, and silently downgrading a consent gate to prose would be
  // accepted-and-silently-wrong. Refusals + resolutions land on the record as
  // `artifacts.refused { op: 'dispatch' }` / `artifacts.resolved` — the same
  // facts a `wants` resolution files. Asks WITHOUT a component never reach
  // this function: zero reads, zero events, byte-identical.

  const assertComponentDeliverable = async (
    scope: TypedScope<AgentState>,
    toolName: string,
    component: unknown,
    door: string,
  ): Promise<AskComponent> => {
    assertAskComponent(component, door);
    const ref = component.propsRef;
    if (ref === undefined) return component;
    const store = deps.artifactStore;
    if (store === undefined) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'no-store',
        ref,
        detail: `${door}: component.propsRef set but no artifact store is attached`,
        tool: toolName,
      });
      throw new InvalidAskComponentError(
        'no-store',
        door,
        `component.propsRef ('${ref}') is set but no artifact store is attached, so the ` +
          `screen could never redeem it. Pass \`artifacts\` to Agent.create({ ..., artifacts }) ` +
          `— inMemoryArtifacts(), fileArtifacts({ directory }) or sqliteArtifacts({ file }) — ` +
          `or carry the payload inline as component.props.`,
        ref,
      );
    }
    const meta = await store.head(runScopeOf(scope), ref);
    if (meta === null) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'missing-or-expired',
        ref,
        detail: `${door}: component.propsRef does not resolve in this run's scope`,
        tool: toolName,
      });
      throw new InvalidAskComponentError(
        'unresolved-ref',
        door,
        `component.propsRef ('${ref}') does not resolve in this run's artifact scope — ` +
          `missing, expired, or minted under a different scope. Mint the props BEFORE raising ` +
          `the ask (ctx.artifacts.put(...) in the same run) and pass the ref it returns; a ` +
          `ref the screen cannot redeem must be refused here, at the source, not discovered ` +
          `by the person answering.`,
        ref,
      );
    }
    typedEmit(scope, 'agentfootprint.artifacts.resolved', {
      ref: meta.ref,
      via: 'head',
      kind: meta.kind,
      bytes: meta.bytes,
      tool: toolName,
    });
    return component;
  };

  // ── The `present` tool's authoritative result (9.22.0, Leg 2) ──────────
  // The skip_step pattern: the auto-attached placeholder ran; the stage —
  // which owns the scope, the store and the emit channel — OVERWRITES its
  // result with the description snapshot (or the teaching refusal), so
  // governance rules and the caps compose over what the model will read.

  const applyPresent = async (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ): Promise<{ readonly ok: boolean; readonly text: string }> => {
    const store = deps.artifactStore;
    if (store === undefined) {
      // Unreachable through the Agent (the tool is only attached beside a
      // store) — kept for the same reason the placeholder text exists.
      return {
        ok: false,
        text: 'present has no artifact store behind it here; nothing was presented.',
      };
    }
    const outcome = await presentArtifact(store, runScopeOf(scope), call.args);
    if (!outcome.ok) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: outcome.missedRef !== undefined ? 'missing-or-expired' : 'invalid-input',
        ...(outcome.missedRef !== undefined && { ref: outcome.missedRef }),
        detail: outcome.refusal,
        tool: PRESENT_TOOL_NAME,
      });
      return { ok: false, text: outcome.refusal };
    }
    const { ref, as, snapshot } = outcome.result;
    typedEmit(scope, 'agentfootprint.artifacts.resolved', {
      ref,
      via: 'head',
      kind: snapshot.kind,
      bytes: snapshot.bytes,
      tool: PRESENT_TOOL_NAME,
    });
    typedEmit(scope, 'agentfootprint.artifacts.presented', {
      ref,
      as,
      snapshot: { ...snapshot },
      toolCallId: call.toolCallId,
      iteration: call.iteration,
    });
    // The snapshot lives INSIDE the tool result — the one thing provider
    // history keeps typed and durable — so a reloaded conversation can
    // re-draw the pane, or state honestly why it can't.
    return { ok: true, text: safeStringify(outcome.result) };
  };

  // ── The placement threshold (9.22.0, Leg 3) — ONE judge, every door ────
  // Called beside every `capResults` site, on the FINALIZED values (after
  // the tool's own resultCeiling, after the after-tool chain) and before the
  // truncation net — the stated precedence: author's refusal first, then the
  // operator's ref-ing, then the last-resort net (which then measures the
  // ticket). A placed result is a TICKET, not a refusal: the caller's
  // effects/step bookkeeping proceeds exactly as if the payload had landed.
  //
  // ── WHAT ROUTING SEES AFTERWARDS (the coupling, stated at both ends) ───
  // The substitute returned here becomes `resultStr` below, which is the ONE
  // string every downstream reader gets: the `role: 'tool'` history message,
  // `scope.lastToolResult.result`, and each `scope.toolResults[]` entry. Route
  // `when` predicates and `rule` triggers read exactly that string
  // (`InjectionContext.lastToolResult` / `toolResults` — the other end of this
  // comment lives on those fields), so raising or lowering `maxInlineChars`
  // CAN change which edge fires: a predicate matching on payload text stops
  // matching once the payload becomes a ticket, and one matching on
  // `"kind":"tool-result/<tool>"` only ever matches after placement.
  //
  // That is the layering, not an accident. The alternative — predicates
  // reading the pre-placement text while the model reads the ticket — would
  // route on a string that is not in the conversation, and the whole point of
  // reading `lastToolResult` is to react to what the MODEL was told. Keep the
  // two identical: whatever the model reads is what routing judges. (Tool NAME
  // edges — `onToolReturn` — and `onToolStatus` are unaffected either way;
  // neither reads the result text.)

  const placeResults = async (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    values: { readonly result: unknown; readonly modelResult: unknown },
    eligible: boolean,
  ): Promise<{ readonly result: unknown; readonly modelResult: unknown }> => {
    const placement = deps.placement;
    if (placement === undefined || deps.artifactStore === undefined || !eligible) return values;
    const text =
      typeof values.modelResult === 'string'
        ? values.modelResult
        : safeStringify(values.modelResult);
    if (text.length <= placement.maxInlineChars) return values;
    const bound = toolArtifacts(scope, call.toolName, call.toolCallId);
    let meta: ArtifactMeta;
    try {
      // The payload stored is the EXACT text the model would have read —
      // byte-faithful, so a consumer redeems precisely what was displaced.
      // `mediaType` states what that text is: a JSON serialization when the
      // tool returned a value, plain text when it returned a string.
      meta = await bound.artifacts.put({
        kind: placedResultKind(call.toolName),
        mediaType: typeof values.modelResult === 'string' ? 'text/plain' : 'application/json',
        data: text,
        label: `${call.toolName} result`,
      });
    } catch (err) {
      // The store could not take it (a payload over the whole scope budget,
      // say). The refusal is already on the record via the capability sink;
      // the honest fallback is today's path — the truncation net still
      // measures what placement could not lift. Named in dev mode.
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint placement: tool '${call.toolName}' result (${text.length} chars) ` +
            `exceeded the ${placement.maxInlineChars}-char threshold but could not be ` +
            `stored: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return values;
    }
    const substitute = placedToolResult(call.toolName, meta, text.length, placement.maxInlineChars);
    return {
      // One ticket when the two channels carry one value — the capResults
      // law. A chain-transformed `result` keeps its own truth and meets the
      // truncation net below, exactly as before.
      result: values.result === values.modelResult ? substitute : values.result,
      modelResult: substitute,
    };
  };

  /**
   * Fire the `'call'`-scoped cleanups this tool call registered.
   *
   * Runs when `execute` SETTLES — resolve or throw — because a tool that threw
   * halfway may well have opened the thing it was about to close. Deliberately
   * NOT on the pause path: a paused call has not settled, it is waiting for a
   * person, and its resources are exactly what the resume needs.
   */
  const endCall = async (toolCallId: string): Promise<void> => {
    await deps.toolSessions?.().fireCall(toolCallId);
  };

  /**
   * The conversation the check-in gate judges — the run history with a synthetic
   * `system` frame in front of it.
   *
   * The system prompt is not in `scope.history` (the slots assemble it
   * separately), so without this the evidence's `read` and the `drivers` ranking
   * could cite the conversation but never a system RULE, and a `CheckInDemand`
   * predicate reading `ctx.history` would be judging a different conversation
   * than the one the run actually had.
   *
   * Hoisted to the handler closure because BOTH gate sites need the SAME shape:
   * the loop's gate (which decides whether to pause) and the ask-resume gate
   * (which decides whether that pause was owed). A predicate that answered
   * differently on the two sides would make the refusal depend on which door the
   * call came through, and that is not a property of the tool.
   */
  const historyForCheckIn = (
    scope: TypedScope<AgentState>,
    history: readonly LLMMessage[],
  ): LLMMessage[] => {
    const systemPrompt = (
      (scope.systemPromptInjections as readonly InjectionRecord[] | undefined) ?? []
    )
      .map((r) => r.rawContent ?? '')
      .filter((s) => s.length > 0)
      .join('\n\n');
    return systemPrompt ? [{ role: 'system', content: systemPrompt }, ...history] : [...history];
  };

  // Resolve a tool by name. Hoisted to the handler closure so BOTH `execute`
  // (the ReAct loop) and `resume` (an approved check-in re-executes here) share
  // one resolver. The Tools slot already invoked `provider.list(ctx)` this
  // iteration and cached the resolved Tool[] in `providerToolCache` — read from
  // there to avoid a second discovery call (vital for async network providers).
  const lookupTool = (toolName: string): Tool | undefined => {
    const fromRegistry = registryByName.get(toolName);
    if (fromRegistry) return fromRegistry;
    if (!externalToolProvider) return undefined;
    const cached = providerToolCache?.current ?? [];
    return cached.find((t) => t.schema.name === toolName);
  };

  /**
   * The after-tool moment: the chain's last word, on a call that RAN.
   *
   * Called from all FIVE dispatch sites and from nowhere else — the loop, an
   * approved ask, an approved check-in, a granted credential consent, and (since
   * 8.13.0) a resumed `pauseHere` / `askHuman`. Every one of them has just
   * produced the result of a call that ran, which is the entire precondition. A
   * call the chain denied, a call whose args were rejected, a call whose
   * credential never issued and a call still waiting on a person have no result,
   * and asking a rule about a result that does not exist would be the same
   * fabrication the outcome union removes.
   *
   * On the `pauseHere` path the value is the one a PERSON supplied, and that is
   * still this moment's business: the handler's contract is that the human's
   * answer IS the paused tool's result — it lands as `role: 'tool'` under the
   * same `toolCallId`, `stream.tool_end` reports it, and `lastToolResult` fires
   * `on-tool-return` triggers off it. A redaction rule that runs on every other
   * tool result and not on that one is a redaction rule with a hole in it, in
   * the one channel where a person can paste a secret.
   *
   * Returns what the MODEL reads. The real result stays with the caller for
   * `stream.tool_end`, so an event stream keeps reporting what the tool
   * returned while the history carries what the rules allowed through — and
   * the ledger row beside them says which is which.
   */
  const afterMoment = async (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool?: Tool;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly args: ToolArgs;
      readonly result: unknown;
      readonly error?: boolean;
      readonly history: readonly LLMMessage[];
      readonly identity?: { tenant?: string; principal?: string; conversationId: string };
      readonly signal?: AbortSignal;
    },
  ): Promise<unknown> => {
    const chain = deps.toolMiddleware ?? [];
    // No `onToolResult` hook anywhere in the chain → no walk, no rows, no await
    // beyond the ones this dispatch already made. An agent whose middleware
    // only governs calls is byte-identical to one built before this moment
    // existed.
    if (!chain.some((mw) => typeof mw.onToolResult === 'function')) return call.result;
    const verdict = await runToolAfterChain(chain, {
      toolName: call.toolName,
      ...(call.tool?.source !== undefined && { toolSource: call.tool.source }),
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      args: call.args,
      result: call.result,
      ...(call.error === true && { error: true as const }),
      history: call.history,
      ...(call.identity && { identity: call.identity }),
      ...(call.signal && { signal: call.signal }),
    });
    recordDecisions(scope, verdict.decisions);
    return verdict.kind === 'deny' ? verdict.reason : verdict.result;
  };

  // Resolve a tool's declared credential (declare-and-push) and execute it,
  // emitting the same credential.* events as the main loop. Used by the
  // check-in RESUME path when a human APPROVES — the tool never ran at pause
  // time (that's the whole point: consent BEFORE credentials + execute), so it
  // runs now. Fail-closed: a blocked/failed credential surfaces to the model
  // and the tool does NOT run. A tool that pauses again during an approved
  // resume can't re-pause (resume returns void), so that is surfaced as an error.
  const resolveCredentialAndExecute = async (
    scope: TypedScope<AgentState>,
    tool: Tool | undefined,
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    toolCallId: string,
    iteration: number,
    env: { readonly signal?: AbortSignal },
  ): Promise<{
    result: unknown;
    error?: boolean;
    executed?: boolean;
    /** The recognized effects envelope, when the tool returned one (9.19.0)
     *  — `result` above is already its unwrapped `content`. When the ceiling
     *  fired this carries the refusal as `content` and status `'invalid'`
     *  (synthesized empty-effects for a non-envelope result), so every resume
     *  path routes the status without knowing about ceilings. */
    envelope?: ReadToolResultEnvelope;
    /** The tool's own `resultCeiling` refused the result (9.20.0): `result`
     *  is the teaching refusal, the true size is on the record. The call ran
     *  — but it must not complete a procedure step (the model was told to
     *  call again). */
    ceilingRefused?: true;
  }> => {
    if (!tool) return { result: `Unknown tool: ${toolName}`, error: true };
    // Declared artifact arguments (9.22.0) — the same resolution the batch
    // loop applies, at this door: a resumed call's refs are judged exactly
    // as an inline call's, BEFORE credentials, and a refusal means the tool
    // does not run.
    let wantedMeta: Readonly<Record<string, ArtifactMeta>> | undefined;
    if (tool.wants !== undefined) {
      const resolution = await resolveWantsAtDispatch(
        scope,
        toolName,
        tool.wants,
        args,
        tool.schema.inputSchema,
      );
      if (!resolution.ok) return { result: resolution.refusal, error: true };
      args = resolution.args;
      wantedMeta = resolution.wanted;
    }
    const runIdentity = scope.runIdentity as
      | { tenant?: string; principal?: string; conversationId: string }
      | undefined;
    let resolvedCredential: Credential | undefined;
    const need = tool.needs;
    if (need) {
      typedEmit(scope, 'agentfootprint.credential.requested', {
        service: need.credential,
        ...(need.mode && { mode: need.mode }),
      });
      try {
        const cred = await credentials.getCredential({
          service: need.credential,
          ...(need.scopes && { scopes: need.scopes }),
          ...(need.mode && { mode: need.mode }),
          ...(runIdentity && {
            identity: {
              ...(runIdentity.principal && { principal: runIdentity.principal }),
              ...(runIdentity.tenant && { tenant: runIdentity.tenant }),
            },
          }),
        });
        if (cred.status === 'issued') {
          resolvedCredential = cred.credential;
          typedEmit(scope, 'agentfootprint.credential.acquired', {
            service: need.credential,
            kind: cred.credential.kind,
            ...(cred.expiresAt !== undefined && { expiresAt: cred.expiresAt }),
          });
          // The consent that was outstanding for this service has been given.
          deps.clearConsentOutstanding?.(need.credential);
        } else {
          typedEmit(scope, 'agentfootprint.credential.authorization_required', {
            service: need.credential,
            sessionId: cred.sessionId,
          });
          // Still not authorized on the far side of a resume. A resume cannot
          // pause again (`ResumeFn` returns void), so the honest move is the
          // URL-free refusal plus `error: true`: the model reads it, the loop
          // continues, and if it calls the tool again `execute` CAN pause — a
          // fresh consent round with a fresh URL on `PendingAsk`. The
          // consent record still goes out on the side channel so the turn
          // cannot end quietly.
          deps.reportConsentOutstanding?.({
            service: need.credential,
            authorizationUrl: cred.authorizationUrl,
            sessionId: cred.sessionId,
            tool: toolName,
            iteration,
          });
          return { result: modelRefusal(need.credential), error: true };
        }
      } catch (credErr) {
        const reason = credErr instanceof Error ? credErr.message : String(credErr);
        typedEmit(scope, 'agentfootprint.credential.failed', {
          service: need.credential,
          reason,
          tool: toolName,
          ...(errorClassOf(credErr) !== undefined && { errorClass: errorClassOf(credErr) }),
        });
        return { result: `credential error for '${need.credential}': ${reason}`, error: true };
      }
    }
    try {
      const result = await tool.execute(args, {
        toolCallId,
        iteration,
        ...(env.signal && { signal: env.signal }),
        credentials: reportingCredentials(credentials, scope, toolName),
        hasCredentials,
        ...(resolvedCredential && { credential: resolvedCredential }),
        ...toolArtifacts(scope, toolName, toolCallId),
        ...(wantedMeta !== undefined && { wanted: wantedMeta }),
        ...toolProgress(scope, { toolName, toolCallId, iteration }),
        ...sessionContext(scope, toolName, toolCallId),
      });
      await endCall(toolCallId);
      // The typed effects channel (9.19.0) — same unwrap as the batch loop,
      // at this path's own execute boundary, so a resumed call's envelope is
      // judged exactly as an inline one's.
      const envelope = readToolResultEnvelope(result);
      if (envelope !== undefined) {
        // Coverage (this release) before the ceiling, for the same reason the
        // effects are judged even when the payload is refused: the boundary a
        // tool declared is not the channel that can overflow, and a limit
        // that died with an oversized result would be the silence this
        // primitive exists to break. An absence's status is the tool's own
        // and wins over the envelope's only when the envelope declared none.
        const coverageStatus = declareCoverage(
          scope,
          { toolName, toolCallId, iteration },
          envelope.content,
        );
        const declaredStatus = envelope.status ?? coverageStatus;
        // The tool's own ceiling (9.20.0) measures the CONTENT — the channel
        // that can overflow a context window. The DECLARED effects are small
        // validated data and are still judged by the caller: a tool that
        // proposed a transition and overflowed its payload does not lose the
        // transition. The delivered status becomes 'invalid' (the declared
        // status described a result the model never received — the
        // `result_refused` event keeps what was declared).
        const refusal = refuseOverCeiling(
          scope,
          { toolName, toolCallId, iteration },
          tool,
          envelope.content,
          declaredStatus,
        );
        if (refusal !== undefined) {
          return {
            result: refusal,
            executed: true,
            ceilingRefused: true,
            envelope: { ...envelope, content: refusal, status: 'invalid' },
          };
        }
        return {
          result: envelope.content,
          executed: true,
          envelope:
            declaredStatus === envelope.status ? envelope : { ...envelope, status: declaredStatus },
        };
      }
      const coverageStatus = declareCoverage(scope, { toolName, toolCallId, iteration }, result);
      const refusal = refuseOverCeiling(
        scope,
        { toolName, toolCallId, iteration },
        tool,
        result,
        coverageStatus,
      );
      if (refusal !== undefined) {
        // Synthesized empty-effects envelope: the resume paths read the
        // routing status off `envelope.status`, and this is how a refused
        // NON-envelope result carries `'invalid'` there without every path
        // learning about ceilings. Empty effects/malformed judge to nothing.
        return {
          result: refusal,
          executed: true,
          ceilingRefused: true,
          envelope: { content: refusal, effects: [], status: 'invalid', malformed: [] },
        };
      }
      // A status-only shape missing its `effects: []` marker is DATA (bytes
      // unchanged) — but never silently: name the dropped marker in dev mode.
      const nearMiss = explainStatusOnlyNearMiss(result);
      if (nearMiss !== undefined) warnEffect(toolName, nearMiss);
      if (coverageStatus !== undefined) {
        // The ceiling path's synthesized envelope, for the same reason: the
        // resume paths read the routing status off `envelope.status`, and an
        // absence that lost its status here would route down whichever edge a
        // statusless result routes down — the confusion the word exists to
        // end. Empty effects/malformed judge to nothing, so the only thing
        // this carries is the status.
        return {
          result,
          executed: true,
          envelope: { content: result, effects: [], status: coverageStatus, malformed: [] },
        };
      }
      return { result, executed: true };
    } catch (err) {
      // Settled by throwing is still settled — a tool that opened a session and
      // then failed must not keep it.
      await endCall(toolCallId);
      if (isPauseRequest(err)) {
        return {
          result: `tool '${toolName}' requested a pause while resuming an approved check-in, which is not supported`,
          error: true,
          // It ran — a tool that asked to pause had already started work.
          executed: true,
        };
      }
      // A tool that threw still RAN, and may have done half its work; the
      // after-tool moment exists precisely for the rules that care about that.
      return {
        result: err instanceof Error ? err.message : String(err),
        error: true,
        executed: true,
      };
    }
  };

  return {
    execute: async (scope) => {
      // Durable-write barrier — the LAST iteration's state must have landed in
      // the session store before THIS iteration's tools are allowed to run.
      // `undefined` (no composer, or nothing outstanding) means no await, no
      // microtask, no behaviour change whatsoever.
      const durable = deps.awaitDurable?.();
      if (durable) await durable;

      // Materialize ONCE — `scope.llmLatestToolCalls` is a live TypedScope
      // deep-Proxy view; spreading yields the raw (plain, structured-clone-
      // safe) elements. This array is embedded into the assistant history
      // message and into typed event payloads (tool_start args,
      // iteration_end history), which must be detached plain data
      // (RFC-001 'clone' capture under observerDelivery: 'deferred').
      const toolCalls = [
        ...(scope.llmLatestToolCalls as readonly {
          readonly id: string;
          readonly name: string;
          readonly args: Readonly<Record<string, unknown>>;
        }[]),
      ];
      const iteration = scope.iteration as number;
      const newHistory: LLMMessage[] = [...(scope.history as readonly LLMMessage[])];
      // ALWAYS push the assistant turn when there are tool calls — even
      // if the content was empty — so providers (Anthropic, OpenAI) can
      // round-trip the tool_use blocks via `LLMMessage.toolCalls`.
      // Without this, the next iteration's request lacks the assistant
      // turn that initiated the tool call, and the API rejects the
      // following tool_result with "preceding tool_use missing".
      if (scope.llmLatestContent || toolCalls.length > 0) {
        // v2.14 — attach thinking blocks (if any). Required for
        // Anthropic signature round-trip: the next request MUST echo
        // back the signed blocks BYTE-EXACT or Anthropic returns 400.
        // Empty array (no thinking) → field omitted from message.
        const thinkingBlocks = (scope as { thinkingBlocks?: readonly unknown[] }).thinkingBlocks;
        const hasThinking = thinkingBlocks !== undefined && thinkingBlocks.length > 0;
        newHistory.push({
          role: 'assistant' as ContextRole,
          content: scope.llmLatestContent ?? '',
          ...(toolCalls.length > 0 && { toolCalls }),
          // Spread = materialize the proxy view (see toolCalls above).
          ...(hasThinking && { thinkingBlocks: [...thinkingBlocks] as never }),
        });
      }
      // `lookupTool` is hoisted to the handler closure (shared with resume).

      // ── The model's `read_skill` pick: one-shot by construction ──────
      // Cleared at the TOP of every iteration that dispatches tools, and set
      // below only when the gate ACCEPTS a pick. Since the only way back into
      // the ReAct loop is through this handler, a pick can never survive into a
      // later iteration and drag the cursor backwards after a declared edge has
      // moved it. Written only for skill-graph agents (the gate is what makes a
      // pick "validated"); a plain read_skill agent never sees this key.
      if (deps.allowedSkillIds) scope.pendingSkillPick = undefined;

      // ── The iteration's tool-result batch, in call order (9.16.0) ────
      // Reset here, appended beside every `lastToolResult` write — each entry
      // stamped as its result lands, so a pause mid-batch commits exactly the
      // results that really happened (the resume paths APPEND the answered
      // call to this same array). `lastToolResult` stays the last entry;
      // `on-tool-return` triggers and skill-graph routes read the batch.
      const batchResults: {
        toolName: string;
        result: string;
        toolCallId: string;
        status?: ToolResultStatus;
      }[] = [];
      scope.toolResults = [];

      // ── The batch's transition bookkeeping (9.19.0) ───────────────────
      // First ACCEPTED `propose-transition` wins (committed at acceptance);
      // later ones to other targets are suppressed + aggregated at batch end.
      const transitionState: TransitionBatchState = { losers: [] };

      // Capture run identity from scope for the enriched permission ctx.
      // Same value the Tools slot passes to ToolProvider.list(ctx) so the
      // checker sees consistent identity across both gates.
      const runIdentity = scope.runIdentity as
        | { tenant?: string; principal?: string; conversationId: string }
        | undefined;
      const env = scope.$getEnv();

      for (const tc of toolCalls) {
        const tool = lookupTool(tc.name);
        typedEmit(scope, 'agentfootprint.stream.tool_start', {
          toolName: tc.name,
          toolCallId: tc.id,
          args: tc.args,
          ...(toolCalls.length > 1 && { parallelCount: toolCalls.length }),
        });
        const startMs = Date.now();
        let result: unknown;
        let error: boolean | undefined;
        /** The typed effects channel (9.19.0) — set only when the tool
         *  returned a recognized result envelope; everything else keeps
         *  today's path byte for byte. */
        let toolEnvelope: ReadToolResultEnvelope | undefined;
        let toolStatus: ToolResultStatus | undefined;
        // Permission gate — when a checker is configured, evaluate BEFORE
        // executing the tool. Emits `permission.check` with the decision.
        //
        // v2.12 — three terminal results:
        //   • 'allow' / 'gate_open' → tool executes normally
        //   • 'deny'                → synthetic tool_result lands; LLM continues
        //   • 'halt'                → synthetic tool_result lands; run terminates
        //                             via scope.$break + Agent.run throws
        //                             PolicyHaltError at the API boundary
        //
        // Strict ordering on halt: synthetic tool_result → halt event →
        // commit (newHistory written to scope) → $break. This guarantees
        // the audit trail is complete before the run terminates, so
        // `agent.resumeOnError(checkpoint)` sees consistent state.
        //
        // The checker receives the in-flight sequence (derived from
        // scope.history), full conversation history, current iteration,
        // identity, and abort signal — enough surface to build sequence-
        // aware policies (forbidden chains, idempotency limits, cost
        // guards) without maintaining parallel state.
        // Args as they will actually be used. The middleware chain below may
        // replace this; everything downstream (validation, the check-in
        // evidence a human approves, credentials, execute, the read_skill
        // gate) reads `callArgs`, never `tc.args`, so there is exactly one
        // answer to "what did this call really run with".
        let callArgs: ToolArgs = tc.args;
        let denied = false;
        /** True once `tool.execute` has been entered — see `afterMoment`. */
        let executed = false;
        /** The tool's own `resultCeiling` refused this call's result (9.20.0)
         *  — the call ran, but it must not complete a procedure step: the
         *  refusal's own instruction is to call again. */
        let ceilingRefused = false;
        let haltContext:
          | {
              reason: string;
              tellLLM: string;
              checkerId?: string;
            }
          | undefined;
        if (permissionChecker) {
          try {
            // Sequence is derived from history at check time (not parallel
            // state) — single source of truth, survives resumeOnError.
            const sequence = extractSequence(newHistory, iteration);
            const decision = await permissionChecker.check({
              capability: 'tool_call',
              actor: 'agent',
              target: tc.name,
              context: tc.args,
              sequence,
              history: newHistory,
              iteration,
              ...(runIdentity && { identity: runIdentity }),
              ...(env.signal && { signal: env.signal }),
            });
            typedEmit(scope, 'agentfootprint.permission.check', {
              capability: 'tool_call',
              actor: 'agent',
              target: tc.name,
              result: decision.result,
              ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
              ...(decision.rationale !== undefined && { rationale: decision.rationale }),
              ...(decision.reason !== undefined && { reason: decision.reason }),
            });
            if (decision.result === 'deny') {
              denied = true;
              // Deny default keeps the existing v2.4 shape (carries
              // rationale text — historically intentional, since deny
              // lets the LLM recover and rationale is consumer-supplied).
              const tellLLM =
                decision.tellLLM ?? `[permission denied: ${decision.rationale ?? 'policy'}]`;
              result = tellLLM;
            } else if (decision.result === 'halt') {
              denied = true;
              // Halt default is DELIBERATELY GENERIC — never falls back
              // to `reason` (which is telemetry, e.g. 'security:exfiltration'
              // — leaking that to the LLM teaches it the rule space).
              // Consumers who want a richer message provide `tellLLM` explicitly.
              const tellLLM =
                decision.tellLLM ?? `Tool '${tc.name}' is not available in this context.`;
              result = tellLLM;
              haltContext = {
                reason: decision.reason ?? decision.rationale ?? 'policy-halt',
                tellLLM,
                ...(permissionChecker.name && { checkerId: permissionChecker.name }),
              };
            }
          } catch (permErr) {
            // A checker that threw is treated as deny-by-default — fail closed:
            // something that did not answer did not say yes.
            //
            // ── What the MODEL is told, and why it changed in 9.4.0 ────────
            // It used to be told the checker's own error text. Those messages
            // are written for operators and read as WEATHER — "not available
            // right now", "ECONNREFUSED", "timed out" — so a model does the
            // reasonable thing and tries again. In a real deployment one did
            // exactly that, burned every iteration to `maxIterations`, and
            // returned the empty string; nobody could see why, because the
            // reason never left the tool result.
            //
            // The refusal is now TERMINAL and says so, in the bracketed form
            // the local policy has always used (`[permission denied: …]`) —
            // the one a model adapts to cleanly. The thrown message is an
            // operator's fact and stays on the typed event's `rationale`,
            // where it was already going: an outage is not something a model
            // should be invited to argue with, and infrastructure text does
            // not belong in a transcript.
            denied = true;
            const msg = permErr instanceof Error ? permErr.message : String(permErr);
            typedEmit(scope, 'agentfootprint.permission.check', {
              capability: 'tool_call',
              actor: 'agent',
              target: tc.name,
              result: 'deny',
              rationale: `permission-checker threw: ${msg}`,
            });
            result =
              `[permission denied: Tool '${tc.name}' could not be authorized. This will not ` +
              `change during this run — do not call it again. Continue without it, or say ` +
              `what you are unable to do.]`;
          }
        }
        /**
         * Ask the checker about ONE capability beyond `'tool_call'`, and apply
         * the verdict exactly as the gate above applies its own (9.11.0).
         *
         * Called only when BOTH sides declared the capability, so a checker
         * that never opted in is never asked and never has to answer a
         * question it was not written for. `sequence` is deliberately absent —
         * the port says it is empty for non-`tool_call` capabilities, and the
         * in-flight tool sequence is not evidence about a capability.
         */
        const askCapability = async (
          capability: PermissionCapability,
          target: string,
          genericHaltText: string,
        ): Promise<void> => {
          if (!permissionChecker) return;
          try {
            const decision = await permissionChecker.check({
              capability,
              actor: 'agent',
              target,
              context: callArgs,
              history: newHistory,
              iteration,
              ...(runIdentity && { identity: runIdentity }),
              ...(env.signal && { signal: env.signal }),
            });
            typedEmit(scope, 'agentfootprint.permission.check', {
              capability,
              actor: 'agent',
              target,
              result: decision.result,
              ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
              ...(decision.rationale !== undefined && { rationale: decision.rationale }),
              ...(decision.reason !== undefined && { reason: decision.reason }),
            });
            if (decision.result === 'deny') {
              denied = true;
              result = decision.tellLLM ?? `[permission denied: ${decision.rationale ?? 'policy'}]`;
            } else if (decision.result === 'halt') {
              denied = true;
              // Same reasoning as the tool_call halt: `reason` is a telemetry
              // tag and teaching the model the rule space is not a service.
              const tellLLM = decision.tellLLM ?? genericHaltText;
              result = tellLLM;
              haltContext = {
                reason: decision.reason ?? decision.rationale ?? 'policy-halt',
                tellLLM,
                ...(permissionChecker.name && { checkerId: permissionChecker.name }),
              };
            }
          } catch (permErr) {
            // Fail closed, and say so terminally — the 9.4.0 lesson applies
            // whole: an operator's outage text reads as weather to a model.
            denied = true;
            const msg = permErr instanceof Error ? permErr.message : String(permErr);
            typedEmit(scope, 'agentfootprint.permission.check', {
              capability,
              actor: 'agent',
              target,
              result: 'deny',
              rationale: `permission-checker threw: ${msg}`,
            });
            result =
              `[permission denied: Tool '${tc.name}' could not be authorized. This will not ` +
              `change during this run — do not call it again. Continue without it, or say ` +
              `what you are unable to do.]`;
          }
        };
        // ── Declared tool capabilities (9.11.0) ──────────────────────────
        // Beside the tool_call gate, at the same layer and before any
        // middleware, so an existing checker still decides first. Asked once
        // per capability the TOOL declared and the CHECKER governs — either
        // side silent and this loop does not run at all, which is why an agent
        // that has not opted in is byte-identical.
        if (!denied && permissionChecker && tool?.capabilities) {
          for (const capability of tool.capabilities) {
            if (denied) break;
            if (!checkerGoverns(permissionChecker, capability)) continue;
            await askCapability(
              capability,
              tc.name,
              `Tool '${tc.name}' is not available in this context.`,
            );
          }
        }
        // ── The middleware chain ─────────────────────────────────────────
        // Walked only for a call the permission gate let through, so an
        // existing checker keeps deciding first and a denial there costs
        // nothing. A denial from the chain lands as the tool result, exactly
        // like every other refusal in this loop — the model reads it and
        // adapts. An `ask` commits partial state and pauses, on the same wire
        // the check-in gate uses.
        if (!denied && deps.toolMiddleware && deps.toolMiddleware.length > 0) {
          const chain = await runToolChain(deps.toolMiddleware, {
            toolName: tc.name,
            // Provenance from the tool that is about to run, so a policy can
            // scope to the server that served it. Absent for our own tools.
            ...(tool?.source !== undefined && { toolSource: tool.source }),
            toolCallId: tc.id,
            iteration,
            args: callArgs,
            history: newHistory,
            ...(runIdentity && { identity: runIdentity }),
            ...(env.signal && { signal: env.signal }),
          });
          recordDecisions(scope, chain.decisions);
          callArgs = chain.args;
          if (chain.kind === 'deny') {
            denied = true;
            result = chain.reason;
          } else if (chain.kind === 'ask') {
            // The typed half of the question (9.24.0), judged BEFORE anything
            // is committed: a component the screen could not render must
            // refuse here, at the source, not pause and be discovered. The
            // `ask()` constructor already checked the shape; a hand-built
            // outcome literal bypasses it, so the shape is re-asserted at
            // this boundary (cheap, idempotent) along with the propsRef
            // resolution only a raise site can judge. Asks without a
            // component skip all of it.
            const askComponent =
              chain.payload.component !== undefined
                ? await assertComponentDeliverable(
                    scope,
                    tc.name,
                    chain.payload.component,
                    `ask middleware '${chain.middleware}'`,
                  )
                : undefined;
            // Commit partial state so resume() finds history intact (the
            // pauseHere / check-in path does the same). The TRANSFORMED args
            // ride the checkpoint: a person approves what the chain produced,
            // not what the model originally proposed.
            scope.history = newHistory;
            scope.pausedToolCallId = tc.id;
            scope.pausedToolName = tc.name;
            scope.pausedToolStartMs = startMs;
            scope.pausedAsk = true;
            scope.pausedAskArgs = chain.args;
            scope.pausedAskIndex = chain.index;
            scope.pausedAskMiddleware = chain.middleware;
            // Which surface will collect the decision — carried so the
            // resume-side ledger rows can say which component ANSWERED.
            // Written only when one exists: a component-less ask's
            // checkpoint stays byte-identical.
            if (askComponent !== undefined) scope.pausedComponentId = askComponent.componentId;
            // A defined return value triggers the footprintjs pause; this
            // object becomes the checkpoint's pauseData, and detectPause
            // surfaces `pauseData.ask` as `outcome.ask`.
            return {
              toolCallId: tc.id,
              toolName: tc.name,
              ask: { ...chain.payload, middleware: chain.middleware },
            };
          }
        }
        // Tool-args validation (#9) — AFTER the permission gate (policy must
        // see every attempted call, valid or not) and BEFORE credential
        // resolution (never acquire credentials for a call that won't run).
        // On 'enforce' mismatch the tool is NOT executed; the model gets a
        // structured retry message as the tool result and corrects its args
        // on the next ReAct iteration. Unknown tools keep the existing
        // "Unknown tool" path below — validation only applies to resolved
        // tools (their inputSchema is the contract the LLM was shown).
        let argsRejected = false;
        if (!denied && tool && toolArgValidation !== 'off') {
          const verdict = validateToolArgs(callArgs, tool.schema.inputSchema);
          if (!verdict.ok) {
            typedEmit(scope, 'agentfootprint.validation.args_invalid', {
              toolName: tc.name,
              toolCallId: tc.id,
              iteration,
              issues: verdict.issues,
              enforced: toolArgValidation === 'enforce',
            });
            if (toolArgValidation === 'enforce') {
              argsRejected = true;
              error = true;
              result = formatToolArgIssues(tc.name, verdict.issues);
            }
          }
        }
        // ── Skill-activation gate (9.11.0) ───────────────────────────────
        // `read_skill` activating a skill the policy hides for this role. The
        // menu the model reads was already filtered (the Tools slot asks the
        // same checker the same question), so this is the second half of one
        // rule rather than a second rule: a model that guessed a hidden id, or
        // remembered one from an earlier turn, reads the policy's own message.
        //
        // Ordered AFTER arg validation so the id judged is the one that will
        // actually run — a middleware may have rewritten it — and BEFORE
        // check-in, credentials and execute, so a refused skill's body is
        // never even computed (`surfaceMode: 'tool-only'` returns it from
        // `execute`). Off entirely unless the checker declares it governs
        // `'skill_read'`.
        if (
          !denied &&
          !argsRejected &&
          tc.name === 'read_skill' &&
          checkerGoverns(permissionChecker, 'skill_read')
        ) {
          const requestedSkillId = (callArgs as { id?: unknown }).id;
          if (typeof requestedSkillId === 'string' && requestedSkillId.length > 0) {
            await askCapability(
              'skill_read',
              skillTarget(requestedSkillId),
              `Skill '${requestedSkillId}' is not available in this context.`,
            );
          }
        }
        // ── Check-in gate (evidence-carrying human consent) ──────────────
        // Ordered AFTER the permission gate + arg-validation (a call the policy
        // denied or that has invalid args never asks a human) and BEFORE
        // credential resolution + execute (never acquire credentials for a call
        // awaiting consent — that's the whole point of "consent WITH the
        // receipts"). Fires ONLY when the tool declared `checkIn` and it trips,
        // so tools without the field are byte-identical (no gate, no events, no
        // pause). Rides the EXISTING pause machinery: returning a defined value
        // triggers the footprintjs checkpoint, exactly like `pauseHere`.
        if (!denied && !argsRejected && tool && tool.checkIn !== undefined && deps.checkIn) {
          // Computed ONLY for a checkIn-declaring tool → zero cost otherwise.
          // Shape shared with the ask-resume gate; see `historyForCheckIn`.
          const historyForEvidence = historyForCheckIn(scope, newHistory);
          if (
            !shouldCheckIn(tool.checkIn, callArgs, {
              iteration,
              toolCallId: tc.id,
              history: historyForEvidence,
            })
          ) {
            // Predicate said no — fall through to the normal credential+execute
            // path below (this `if` block is the ONLY thing the gate adds).
          } else {
            // The tool's declared decision component (9.24.0), judged BEFORE
            // the evidence pack is assembled — a gate that cannot be honored
            // as declared refuses before any work, and a dangling propsRef is
            // refused at this source rather than discovered by the screen.
            const gateComponent =
              tool.checkInComponent !== undefined
                ? await assertComponentDeliverable(
                    scope,
                    tc.name,
                    tool.checkInComponent,
                    `tool '${tc.name}' checkInComponent`,
                  )
                : undefined;
            const intent = scope.llmLatestContent ? String(scope.llmLatestContent) : undefined;
            const evidence = await deps.checkIn.assembler({
              tool: { name: tc.name, description: tool.schema.description },
              args: callArgs,
              ...(intent !== undefined && { intent }),
              iteration,
              history: historyForEvidence,
              scorer: deps.checkIn.scorer,
              ...(env.signal && { signal: env.signal }),
            });
            const request: CheckInRequest = {
              tool: tc.name,
              args: callArgs,
              ...(intent !== undefined && { intent }),
              evidence,
              ...(gateComponent !== undefined && { component: gateComponent }),
            };
            typedEmit(scope, 'agentfootprint.checkin.request', {
              toolName: tc.name,
              toolCallId: tc.id,
              iteration,
              request: request as unknown as Readonly<Record<string, unknown>>,
            });
            // Commit partial state so resume() finds history intact (mirror the
            // pauseHere path). The proposed args ride the checkpoint so an
            // APPROVED tool can execute on resume.
            scope.history = newHistory;
            scope.pausedToolCallId = tc.id;
            scope.pausedToolName = tc.name;
            scope.pausedToolStartMs = startMs;
            scope.pausedCheckIn = true;
            scope.pausedCheckInArgs = callArgs;
            // Which surface will collect the decision — read back on resume
            // so `checkin.decision` says which component ANSWERED. Written
            // only when one exists (byte-identical otherwise).
            if (gateComponent !== undefined) scope.pausedComponentId = gateComponent.componentId;
            // Returning a defined value triggers the footprintjs pause; the
            // returned object becomes the checkpoint's pauseData. detectPause
            // surfaces `pauseData.checkIn` as `outcome.checkIn`.
            return { toolCallId: tc.id, toolName: tc.name, checkIn: request };
          }
        }
        if (!denied && !argsRejected) {
          // ── Declared artifact arguments (9.22.0) ──────────────────────
          // The `needs` precedent applied to data: resolve the tool's
          // declared `wants` refs BEFORE credential resolution (never
          // acquire credentials for a call that won't run) and BEFORE
          // execute — a stale/unknown/wrong-kind ref never reaches the
          // tool; the model reads a teaching refusal listing the live refs
          // of the wanted kind. On success `callArgs` carries the RESOLVED
          // DATA and `ctx.wanted` the claim tickets. Tools without `wants`
          // take the exact path they always took.
          let wantedMeta: Readonly<Record<string, ArtifactMeta>> | undefined;
          let wantsBlocked = false;
          if (tool?.wants !== undefined) {
            const resolution = await resolveWantsAtDispatch(
              scope,
              tc.name,
              tool.wants,
              callArgs,
              tool.schema.inputSchema,
            );
            if (resolution.ok) {
              callArgs = resolution.args;
              wantedMeta = resolution.wanted;
            } else {
              wantsBlocked = true;
              error = true;
              result = resolution.refusal;
            }
          }
          // Declare-and-push: resolve the tool's declared credential BEFORE
          // invoking, and inject it as ctx.credential. On consent-required or
          // failure, surface the reason to the LLM (tool result) + emit; the
          // tool does NOT run (fail-closed — never half-authed; a denial that
          // throws is surfaced, not retried).
          let resolvedCredential: Credential | undefined;
          let credentialBlocked = false;
          const need = wantsBlocked ? undefined : tool?.needs;
          if (need) {
            typedEmit(scope, 'agentfootprint.credential.requested', {
              service: need.credential,
              ...(need.mode && { mode: need.mode }),
            });
            try {
              const cred = await credentials.getCredential({
                service: need.credential,
                ...(need.scopes && { scopes: need.scopes }),
                ...(need.mode && { mode: need.mode }),
                ...(runIdentity && {
                  identity: {
                    ...(runIdentity.principal && { principal: runIdentity.principal }),
                    ...(runIdentity.tenant && { tenant: runIdentity.tenant }),
                  },
                }),
              });
              if (cred.status === 'issued') {
                resolvedCredential = cred.credential;
                typedEmit(scope, 'agentfootprint.credential.acquired', {
                  service: need.credential,
                  kind: cred.credential.kind,
                  ...(cred.expiresAt !== undefined && { expiresAt: cred.expiresAt }),
                });
                deps.clearConsentOutstanding?.(need.credential);
              } else {
                credentialBlocked = true;
                // The event has ALWAYS carried `{ service, sessionId }` and
                // never the URL (6.11.0's contract). That was right; what was
                // wrong was the tool-result string below, which carried the URL
                // to the one party that cannot click it and to every channel
                // built to preserve tool output.
                typedEmit(scope, 'agentfootprint.credential.authorization_required', {
                  service: need.credential,
                  sessionId: cred.sessionId,
                });
                if (onAuthorizationRequired === 'pause') {
                  // Consent is unfinished work, and unfinished work is a pause
                  // — the same wire the check-in gate and a middleware `ask`
                  // ride. Commit partial state so resume() finds history
                  // intact; the proposed args ride the checkpoint so the tool
                  // can run once the person has consented.
                  scope.history = newHistory;
                  scope.pausedToolCallId = tc.id;
                  scope.pausedToolName = tc.name;
                  scope.pausedToolStartMs = startMs;
                  scope.pausedCredential = true;
                  scope.pausedCredentialArgs = callArgs;
                  scope.pausedCredentialService = need.credential;
                  // A defined return value triggers the footprintjs pause; this
                  // object becomes the checkpoint's pauseData, and standingAgent's
                  // describePause hands it to the caller as `PendingAsk`.
                  // `CONSENT_PAUSE_KEY` is what lets `pause.request` withhold
                  // the URL from the event stream by name.
                  return {
                    toolCallId: tc.id,
                    toolName: tc.name,
                    question: consentQuestion(need.credential, tc.name),
                    [CONSENT_PAUSE_KEY]: {
                      service: need.credential,
                      authorizationUrl: cred.authorizationUrl,
                      sessionId: cred.sessionId,
                    },
                  };
                }
                // `'tell-model'`: the model reads a refusal naming the service
                // and never the URL, and may route around the block. The turn
                // cannot report a clean completion — the record goes out on the
                // side channel and `Agent.finalizeResult` raises.
                error = true;
                result = modelRefusal(need.credential);
                deps.reportConsentOutstanding?.({
                  service: need.credential,
                  authorizationUrl: cred.authorizationUrl,
                  sessionId: cred.sessionId,
                  tool: tc.name,
                  iteration,
                });
              }
            } catch (credErr) {
              credentialBlocked = true;
              error = true;
              const reason = credErr instanceof Error ? credErr.message : String(credErr);
              typedEmit(scope, 'agentfootprint.credential.failed', {
                service: need.credential,
                reason,
                tool: tc.name,
                ...(errorClassOf(credErr) !== undefined && { errorClass: errorClassOf(credErr) }),
              });
              result = `credential error for '${need.credential}': ${reason}`;
            }
          }
          if (!credentialBlocked && !wantsBlocked) {
            try {
              if (!tool) throw new Error(`Unknown tool: ${tc.name}`);
              // Set BEFORE the await: a tool that throws has still run, and a
              // tool that does not exist has not. This flag is the entire
              // precondition of the after-tool moment below.
              executed = true;
              result = await tool.execute(callArgs, {
                toolCallId: tc.id,
                iteration,
                ...(env.signal && { signal: env.signal }),
                credentials: reportingCredentials(credentials, scope, tc.name),
                hasCredentials,
                ...(resolvedCredential && { credential: resolvedCredential }),
                ...toolArtifacts(scope, tc.name, tc.id),
                ...(wantedMeta !== undefined && { wanted: wantedMeta }),
                ...toolProgress(scope, { toolName: tc.name, toolCallId: tc.id, iteration }),
                ...sessionContext(scope, tc.name, tc.id),
              });
              // A code-runner tool leaves the SHAPE of what it just ran, keyed by
              // this call. Taken and deleted here so the map cannot grow across
              // a long run, and emitted from the dispatch loop rather than from
              // the tool because this is the layer that holds `typedEmit`.
              //
              // The code itself is never on this channel — the same rule the
              // session events follow with `keyHash`, never the key. Generated
              // code quotes the data it was handed, so the program is the one
              // part of a code run that must not reach an exporter.
              const ranCode = codeRunsOf(tool)?.get(tc.id);
              if (ranCode !== undefined) {
                (codeRunsOf(tool) as Map<string, unknown> | undefined)?.delete(tc.id);
                typedEmit(scope, 'agentfootprint.tools.code_run', ranCode);
              }
              // The typed effects channel (9.19.0): a recognized envelope is
              // unwrapped HERE, at the one boundary the raw return crosses —
              // everything downstream (governance rules, the cap, history,
              // `tool_end`) sees the CONTENT, exactly what a bare return
              // would have shown. The effects are judged below, after the
              // gates, in call order.
              const envelope = readToolResultEnvelope(result);
              if (envelope !== undefined) {
                toolEnvelope = envelope;
                result = envelope.content;
                toolStatus = envelope.status;
              } else {
                // A status-only shape missing its `effects: []` marker is
                // DATA (bytes unchanged) — but never silently: name the
                // dropped marker in dev mode.
                const nearMiss = explainStatusOnlyNearMiss(result);
                if (nearMiss !== undefined) warnEffect(tc.name, nearMiss);
              }
              // Coverage (this release), on the UNWRAPPED content and before
              // the ceiling — the boundary a tool declared is not the channel
              // that can overflow. A tool that spelled its own status keeps
              // it; otherwise an absence names the delivered outcome, so an
              // `onToolStatus` edge can route "we looked and there was
              // nothing" somewhere other than "the call broke".
              const coverageStatus = declareCoverage(
                scope,
                { toolName: tc.name, toolCallId: tc.id, iteration },
                result,
              );
              if (toolStatus === undefined) toolStatus = coverageStatus;
              // The tool's own refusing ceiling (9.20.0) — at the execute
              // boundary, BEFORE the gates and the after-tool chain, so
              // governance and the agent-level cap compose over what the
              // model will actually read (the read_skill-gate precedent).
              // A recognized envelope's DECLARED effects (`toolEnvelope`)
              // are still judged below — the effects channel is not the
              // channel that overflowed; the delivered status becomes
              // 'invalid' so `onToolStatus` edges can route the overflow
              // (the declared one rides the `result_refused` event).
              const overflowRefusal = refuseOverCeiling(
                scope,
                { toolName: tc.name, toolCallId: tc.id, iteration },
                tool,
                result,
                toolStatus,
              );
              if (overflowRefusal !== undefined) {
                ceilingRefused = true;
                result = overflowRefusal;
                toolStatus = 'invalid';
              }
              await endCall(tc.id);
            } catch (err) {
              if (isPauseRequest(err)) {
                // The typed half of the question (9.24.0): a tool that raised
                // `askHuman({ question, component })` nominated a screen
                // component, and the nomination is judged HERE — the raise
                // site — before the pause is allowed to happen. The tool
                // usually minted `propsRef` via ctx.artifacts moments ago;
                // this validates the ref it chose to carry still resolves in
                // this run's scope, so the throw (which fails the run loudly,
                // naming the fix) lands in the author's lap and never in the
                // answering person's. Pauses without a component skip this
                // entirely — byte-identical.
                if (typeof err.data === 'object' && err.data !== null) {
                  const rawComponent = (err.data as { component?: unknown }).component;
                  if (rawComponent !== undefined) {
                    await assertComponentDeliverable(
                      scope,
                      tc.name,
                      rawComponent,
                      `askHuman in tool '${tc.name}'`,
                    );
                  }
                }
                // A pause has NOT settled this call — it is waiting for a
                // person, and the resources it opened are what the resume
                // needs. No `'call'` teardown here, deliberately.
                //
                // Commit partial state so resume() can find history intact.
                scope.history = newHistory;
                scope.pausedToolCallId = tc.id;
                scope.pausedToolName = tc.name;
                scope.pausedToolStartMs = startMs;
                // The args the tool WAS RUNNING WITH (post-transform), for the
                // after-tool moment on the far side of the pause (8.13.0) —
                // the same reason the three sibling pauses carry theirs.
                scope.pausedToolArgs = callArgs;
                // Returning a defined value triggers footprintjs pause —
                // the returned object becomes the checkpoint's pauseData.
                return {
                  toolCallId: tc.id,
                  toolName: tc.name,
                  ...(typeof err.data === 'object' && err.data !== null
                    ? (err.data as Record<string, unknown>)
                    : { data: err.data }),
                };
              }
              // A tool that threw still RAN, and may have opened the thing it
              // was about to close.
              await endCall(tc.id);
              error = true;
              result = err instanceof Error ? err.message : String(err);
            }
          }
        }
        // ── Skill-graph read_skill GATE ────────────────────────
        // Reject a read_skill jump OUTSIDE the reachable set from the current
        // cursor: replace the result with a re-prompt naming the allowed ids (so
        // the model re-picks) and skip the activation below — cursor + activations
        // stay unchanged. Off when no skillGraph (deps.allowedSkillIds undefined),
        // so plain read_skill agents are byte-for-byte unaffected.
        //
        // The allowed set is two kinds of id, and the difference is the whole
        // design (8.4.0): a HOP — a skill the graph routes, reachable from where
        // the cursor stands — and an OPEN skill, one the graph never wires (a
        // `.selfExplain()` debug skill, a `.skill()` registered beside the graph,
        // a skill listed in `skills[]` and wired to nothing). Both activate; only a
        // hop moves the cursor. Before 8.4.0 the open ones were offered in
        // read_skill's own menu and then rejected on every single call — the
        // library refused its own flagship debug feature under its own routing
        // feature, and the model could burn a whole run re-asking.
        let skillRejected = false;
        let skillHop = false;
        if (deps.allowedSkillIds && tc.name === 'read_skill' && !error && !denied) {
          const reqId = (callArgs as { id?: unknown }).id;
          if (typeof reqId === 'string' && reqId.length > 0) {
            const currentSkillId = scope.currentSkillId as string | undefined;
            const hops = deps.allowedSkillIds(currentSkillId);
            skillHop = hops.includes(reqId);
            const allowed = dedupeIds([...hops, ...(deps.openSkillIds ?? [])]);
            if (!allowed.includes(reqId)) {
              skillRejected = true;
              result = skillRefusal(reqId, allowed, deps.skillGraphIsTree === true);
              typedEmit(scope, 'agentfootprint.skill.rejected', {
                requestedId: reqId,
                ...(currentSkillId !== undefined && { currentSkillId }),
                allowed,
                iteration,
              });
              noteSkillRefusal(scope, iteration);
            } else if (deps.skillStrictness !== undefined && skillHop) {
              // ── The POSTURE arm (SG-C) — after reachability, hops only. ──
              // OPEN skills never reach here (skillHop is false for them), so
              // `.selfExplain()` and friends stay admitted under every posture.
              const turnRoute = scope.turnRoute as TurnRoute | undefined;
              const onOutstandingMenu =
                menuOutstanding(turnRoute, currentSkillId) &&
                turnRoute?.offered?.includes(reqId) === true;
              const refusedByPosture =
                deps.skillStrictness === 'rails' ||
                (deps.skillStrictness === 'guard' && !onOutstandingMenu);
              if (refusedByPosture) {
                skillRejected = true;
                skillHop = false; // a refused pick must not move the cursor below
                result = postureRefusal(
                  reqId,
                  deps.skillStrictness,
                  turnRoute,
                  currentSkillId,
                  deps.openSkillIds ?? [],
                );
                typedEmit(scope, 'agentfootprint.skill.rejected', {
                  requestedId: reqId,
                  ...(currentSkillId !== undefined && { currentSkillId }),
                  allowed,
                  iteration,
                  posture: deps.skillStrictness,
                });
                noteSkillRefusal(scope, iteration);
              }
            }
          }
        }

        // ── skip_step bookkeeping (9.18.0) ─────────────────────────────
        // Same block as the read_skill gate, same mechanism: the stage
        // OVERWRITES the tool's placeholder with the authoritative sentence
        // BEFORE the after-tool moment, so governance rules and the cap
        // compose over what the model will actually read, on both channels.
        // Postures never gate it — skipping is judgment inside a step, not
        // routing. Zero-cost gate: `stepPlanFor` is undefined on every agent
        // without a stepped skill.
        if (deps.stepPlanFor && tc.name === SKIP_STEP_TOOL_NAME && !error && !denied) {
          result = applySkipStep(scope, { args: callArgs, toolCallId: tc.id, iteration });
        }

        // ── present bookkeeping (9.22.0) ───────────────────────────────
        // Same mechanism as skip_step: the auto-attached placeholder ran;
        // the stage overwrites its result with the description snapshot (or
        // the teaching refusal) BEFORE the after-tool moment, so governance
        // and the caps compose over what the model will actually read. A
        // miss is an errored call: the model holds no presentation, and a
        // procedure step whose tool presented nothing must not advance.
        if (deps.artifactStore && tc.name === PRESENT_TOOL_NAME && executed && !error && !denied) {
          const presented = await applyPresent(scope, {
            args: callArgs,
            toolCallId: tc.id,
            iteration,
          });
          result = presented.text;
          if (!presented.ok) error = true;
        }

        // ── The after-tool moment ────────────────────────────────────────
        // Last thing before the result becomes history, and only for a call
        // that ran. `modelResult` is what the model reads; `result` stays the
        // truth about the tool and is what `stream.tool_end` reports.
        const rawModelResult = executed
          ? await afterMoment(scope, {
              ...(tool && { tool }),
              toolName: tc.name,
              toolCallId: tc.id,
              iteration,
              args: callArgs,
              result,
              ...(error === true && { error: true }),
              history: newHistory,
              ...(runIdentity && { identity: runIdentity }),
              ...(env.signal && { signal: env.signal }),
            })
          : result;
        // Placement next (9.22.0) — the operator's ref-ing, judged on what
        // the chain let through (a rule that already summarized a huge
        // result is measured on what it produced, the same reasoning as the
        // cap). Over the threshold, the payload is checked into the store
        // and BOTH channels carry the ticket; the truncation net below then
        // measures the ticket. A refused/denied/errored call is never
        // placed: a refusal is already short, and 'tool-result/<name>' must
        // never claim an error is the tool's result.
        const placedValues = await placeResults(
          scope,
          { toolName: tc.name, toolCallId: tc.id, iteration },
          { result, modelResult: rawModelResult },
          executed && !error && !denied && !ceilingRefused,
        );
        // The ceiling, last — after the tool, after the chain. A rule that
        // already summarized a huge result is measured on what it produced, so
        // the cap composes with governance rather than pre-empting it.
        const capped = capResults(tc.name, placedValues);
        const modelResult = capped.modelResult;

        const durationMs = Date.now() - startMs;
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId: tc.id,
          result: capped.result,
          durationMs,
          ...(error === true && { error: true }),
          // The tool's own declared outcome (9.19.0) — additive, envelope
          // tools only.
          ...(toolStatus !== undefined && { status: toolStatus }),
        });
        let resultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        // The tool's OWN answer, before any framework suffix joins it — what
        // the repeated-call ledger fingerprints. Fingerprinting the decorated
        // string instead would compare our own additions (a step that advanced
        // once, an effect note) and miss the repeat they decorate.
        const deliveredResult = resultStr;

        // ── Step boundary (9.18.0): advance decided, then decorate, THEN
        // push — the suffix must be part of the one past every reader sees
        // (history, `lastToolResult`, the batch), never spliced in later.
        // `stream.tool_end` above keeps reporting the tool's own truth.
        if (deps.stepPlanFor) {
          // The activation intro: an ACCEPTED read_skill pick of a stepped
          // skill says where the procedure starts (recency channel §1).
          if (tc.name === 'read_skill' && !error && !denied && !skillRejected) {
            const pickedId = (callArgs as { id?: unknown }).id;
            if (typeof pickedId === 'string' && pickedId.length > 0) {
              resultStr += readSkillStepIntroFor(pickedId);
            }
          }
          // The advance: only a call that RAN clean completes a step — an
          // error result never advances (the pointer holds; the model
          // retries, skips with a reason, or routes around), and neither
          // does a permission denial, a gate refusal, or a ceiling refusal
          // (the model holds no data and was told to call again — advancing
          // would contradict the refusal's own instruction).
          if (executed && !error && !denied && !skillRejected && !ceilingRefused) {
            resultStr += applyStepReturn(scope, {
              toolName: tc.name,
              toolCallId: tc.id,
              iteration,
            });
          }
        }

        // ── Typed tool effects (9.19.0) — judged in call order ──────────
        // Only for a call that RAN clean and returned an envelope. Refusal
        // notes join the model-visible result AFTER the cap (framework
        // truth, the step-suffix precedent); accepted effects speak through
        // what they do — the cursor move, the delivered instruction — and
        // through `tools.effect` on the record.
        if (toolEnvelope !== undefined && executed && !error && !denied) {
          resultStr += applyToolEffects(
            scope,
            { toolName: tc.name, toolCallId: tc.id, iteration },
            toolEnvelope,
            transitionState,
          );
        }

        // ── Repeated-call nudge (9.26.0) ───────────────────────────────
        // The framework is the only party that watched all three landings, so
        // it is the only one that can say so. A NOTE on the result — the call
        // ran, nothing was refused, and a later identical call is not blocked.
        // Only for a call that RAN: a permission denial, a gate rejection and
        // a ceiling refusal each already teach their own lesson, and stacking
        // a second one would bury it.
        if (deps.repeatedCallNudge !== false && executed && !denied && !skillRejected) {
          // Counted beside the run, never inside its state: a tracked write is
          // a commit-log entry, a snapshot key, a narrative line and a row in
          // every recording, and a turn that repeats NOTHING must stay
          // byte-identical to the release before this one. `currentRun()` is
          // the same accessor `ctx.runId` is composed from — one answer to
          // "which run is this", not a second spelling of it.
          const runKey = deps.currentRun?.().runId ?? UNSCOPED_RUN;
          const repeat = noteRepeatedCall(
            repeatLedgers.read(runKey),
            tc.name,
            callArgs,
            deliveredResult,
          );
          repeatLedgers.write(runKey, repeat.ledger);
          if (repeat.note !== undefined) {
            resultStr += repeat.note;
            typedEmit(scope, 'agentfootprint.tools.repeated_call', {
              toolName: tc.name,
              toolCallId: tc.id,
              iteration,
              occurrences: repeat.occurrences,
              argsFingerprint: repeat.argsFingerprint,
              resultFingerprint: repeat.resultFingerprint,
            });
          }
        }

        newHistory.push({
          role: 'tool',
          content: resultStr,
          toolCallId: tc.id,
          toolName: tc.name,
        });

        // ── Dynamic ReAct wiring ───────────────────────────────
        //
        // (1) `lastToolResult` drives `on-tool-return` Injection
        //     triggers — the InjectionEngine's NEXT pass will see
        //     this and activate any matching Instructions. Since
        //     9.16.0 the WHOLE batch rides `toolResults` beside it
        //     (call order preserved), so an earlier parallel call's
        //     routing implication is no longer overwritten by a
        //     later sibling's.
        scope.lastToolResult = {
          toolName: tc.name,
          result: resultStr,
          ...(toolStatus !== undefined && { status: toolStatus }),
        };
        batchResults.push({
          toolName: tc.name,
          result: resultStr,
          toolCallId: tc.id,
          ...(toolStatus !== undefined && { status: toolStatus }),
        });
        scope.toolResults = [...batchResults];

        // (2) `read_skill` is the auto-attached activation tool.
        //     When the LLM calls it with a valid Skill id, append
        //     to `activatedInjectionIds` so the InjectionEngine's
        //     NEXT pass activates that Skill (lifetime: turn — stays
        //     active until the turn ends).
        if (tc.name === 'read_skill' && !error && !denied && !skillRejected) {
          const requestedId = (callArgs as { id?: unknown }).id;
          if (typeof requestedId === 'string' && requestedId.length > 0) {
            const current = scope.activatedInjectionIds as readonly string[];
            if (!current.includes(requestedId)) {
              scope.activatedInjectionIds = [...current, requestedId];
            }
            // (3) The same call is also a MOVE through the graph. `read_skill`
            //     answers "activated for the next iteration", and for a skill
            //     whose activation is cursor-gated (a route target, an exclusive
            //     entry) or rule-gated (an intent entry whose rule didn't match)
            //     appending the id alone never made that true — the sentence was
            //     a promise the engine didn't keep. Record the pick the gate just
            //     accepted; the Injection Engine hands it to `graph.nextSkill`,
            //     which moves the cursor unless a declared edge fired first.
            //     Last accepted pick of a parallel batch wins the cursor; all of
            //     them still land in `activatedInjectionIds`.
            //
            //     Only a HOP moves the cursor. An OPEN skill (one the graph never
            //     wires) is not a node, so parking the cursor on it would strand
            //     the graph: every route trigger reads `nextSkill(ctx) === id`, and
            //     from a non-node nothing can fire. It activates through its own
            //     `llm-activated` trigger and the graph stays exactly where it was.
            if (deps.allowedSkillIds && skillHop) scope.pendingSkillPick = requestedId;
          }
        }

        // v2.12 — strict halt ordering (continued).
        //
        // The synthetic tool_result for the halt-triggering call has
        // ALREADY been pushed to newHistory above. Now: emit the halt
        // event, commit history to scope, set the scope flags Agent.run
        // reads at the API boundary, and break the loop. This SKIPS any
        // remaining parallel-call siblings (intentional — once a halt
        // fires, no further tool dispatches should occur this turn).
        if (haltContext) {
          typedEmit(scope, 'agentfootprint.permission.halt', {
            target: tc.name,
            reason: haltContext.reason,
            tellLLM: haltContext.tellLLM,
            iteration,
            sequenceLength: extractSequence(newHistory, iteration).length,
            ...(haltContext.checkerId !== undefined && { checkerId: haltContext.checkerId }),
          });
          scope.history = newHistory;
          scope.policyHaltReason = haltContext.reason;
          scope.policyHaltTellLLM = haltContext.tellLLM;
          scope.policyHaltTarget = tc.name;
          scope.policyHaltArgs = tc.args;
          scope.policyHaltIteration = iteration;
          if (haltContext.checkerId !== undefined) {
            scope.policyHaltCheckerId = haltContext.checkerId;
          }
          scope.$break(`policy-halt: ${haltContext.reason}`);
          return undefined;
        }
      }
      scope.history = newHistory;

      // The batch-end aggregate for conflicting transition proposals
      // (9.19.0) — fires only when ≥2 accepted proposals named different
      // targets; the per-effect events above already told each story.
      emitTransitionConflict(scope, iteration, transitionState);

      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        toolCallCount: toolCalls.length,
        // The PLAIN local array, not `scope.history` — a TypedScope array
        // read returns a live deep-Proxy view, which is not structured-
        // clone-safe. Event payloads must be detached plain data so they
        // survive RFC-001 'clone' capture (observerDelivery: 'deferred')
        // and never hand consumers a mutable view of engine state.
        history: newHistory,
      });
      scope.iteration = iteration + 1;
      return undefined; // explicit: no pause, flow continues to loopTo
    },
    resume: async (scope, input) => {
      // Same barrier as `execute`, for the same reason: an approved check-in
      // runs the REAL tool here, and that side effect must not go out ahead of
      // the state the last write is still carrying.
      const durable = deps.awaitDurable?.();
      if (durable) await durable;

      // Consumer-supplied resume input becomes the paused tool's result.
      // The subflow's pre-pause scope is restored automatically by
      // footprintjs 4.17.0 via `checkpoint.subflowStates`, so
      // `scope.history` and `scope.pausedToolCallId` read back cleanly
      // across same-executor AND cross-executor resume.
      const toolCallId = scope.pausedToolCallId as string;
      const toolName = scope.pausedToolName as string;
      const startMs = scope.pausedToolStartMs as number;

      // ── Middleware-ask decision path ─────────────────────────────────
      // Discriminated by `scope.pausedAsk`, restored from the checkpoint.
      //
      // The answer is a DECISION, not a result. That is the whole reason the
      // outcome union has no `result` arm: a middleware asks a person whether
      // this call may proceed, and on approval the REAL tool runs — the person
      // never writes the tool's answer, and neither does the middleware.
      //
      // A malformed resume DECLINES, for the same reason the check-in path
      // does: a governed call must never execute because a message was
      // mis-shaped.
      if (scope.pausedAsk === true) {
        const iteration = scope.iteration as number;
        const args = (scope.pausedAskArgs ?? {}) as Readonly<Record<string, unknown>>;
        const askIndex = (scope.pausedAskIndex ?? 0) as number;
        const askedBy = (scope.pausedAskMiddleware ?? 'middleware') as string;
        // The registered component that COLLECTED this decision (9.24.0),
        // written at pause time only when the ask carried one — the ledger
        // rows below then say which surface the person answered through.
        const answeredVia = scope.pausedComponentId as string | undefined;
        const decision: CheckInDecision = isCheckInDecision(input)
          ? input
          : checkInDeclined({ by: 'unknown', note: 'resume input was not a CheckInDecision' });

        let result: unknown;
        /** What the model reads. Differs from `result` only when a rule at the
         *  after-tool moment transformed or withheld it. */
        let modelResult: unknown;
        let error: boolean | undefined;
        /** The call REALLY ran, clean — the step-advance eligibility this
         *  path knows about itself (a decline or a chain-deny never ran). */
        let stepToolRan = false;
        /** The effects envelope the resumed call returned (9.19.0). */
        let resumeEnvelope: ReadToolResultEnvelope | undefined;
        if (!decision.approved) {
          result = decision.note ? `declined by human: ${decision.note}` : 'declined by human';
          recordDecisions(scope, [
            {
              middleware: askedBy,
              moment: 'before-tool',
              at: 'tool',
              toolName,
              toolCallId,
              iteration,
              outcome: 'deny',
              changed: false,
              why: `declined by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
              ...(answeredVia !== undefined && { componentId: answeredVia }),
            },
          ]);
        } else {
          recordDecisions(scope, [
            {
              middleware: askedBy,
              moment: 'before-tool',
              at: 'tool',
              toolName,
              toolCallId,
              iteration,
              outcome: 'allow',
              changed: false,
              why: `approved by ${decision.by}${decision.note ? `: ${decision.note}` : ''}`,
              ...(answeredVia !== undefined && { componentId: answeredVia }),
            },
          ]);
          // Continue the chain from the link AFTER the one that asked. Its
          // decision is already on the checkpoint; re-running it would ask the
          // same question twice and file a duplicate row.
          //
          // `askPolicy: 'refuse'` because footprintjs's `PausableHandler.resume`
          // returns void — a resumed dispatch has no second checkpoint to give.
          // A link further down the chain that also wants a person gets a named,
          // model-visible refusal and the tool does NOT run. That is the same
          // rule already applied to a tool that tries to pause during an
          // approved check-in resume: at most one human question per resume.
          // Resolved BEFORE the chain runs, not after, because the links that
          // continue here must see the same `toolSource` the links before the
          // ask saw. A chain that changed its mind about where a tool came from
          // halfway through one dispatch would be worse than not knowing.
          const tool = lookupTool(toolName);
          const rest = await runToolChain(deps.toolMiddleware ?? [], {
            toolName,
            ...(tool?.source !== undefined && { toolSource: tool.source }),
            toolCallId,
            iteration,
            args,
            history: [...(scope.history as readonly LLMMessage[])],
            startIndex: askIndex + 1,
            askPolicy: 'refuse',
          });
          recordDecisions(scope, rest.decisions);
          // Would this tool's OWN consent gate have fired for this call? Asked by
          // EVALUATING the demand, not by noticing that one was declared (8.13.0).
          // Before that, any tool carrying a `checkIn` field was refused here even
          // when its predicate said no — a selective gate (`amount > 1000`) blocked
          // the £5 refunds it was written to let through, and the refusal claimed a
          // consent gate would have run when it provably would not have.
          //
          // Judged on `rest.args` (what the tool would actually run with) and on
          // the same history shape the loop's gate uses, so the answer cannot
          // depend on which door the call arrived through.
          const demandTrips =
            rest.kind !== 'deny' &&
            tool?.checkIn !== undefined &&
            shouldCheckIn(tool.checkIn, rest.args, {
              iteration,
              toolCallId,
              history: historyForCheckIn(scope, scope.history as readonly LLMMessage[]),
            });
          if (rest.kind === 'deny') {
            result = rest.reason;
          } else if (demandTrips) {
            // The one-question rule, from the other direction: this tool's own
            // consent gate really does demand a person for THESE arguments, and
            // there is no checkpoint left to ask with.
            //
            // The two gates ask DIFFERENT questions, which is why an approval of
            // one is not an answer to the other. A middleware `ask` carries the
            // rule's own free-text question; a check-in carries the TOOL's demand
            // with the evidence pack attached — `willDo`, what the run read, what
            // drove the choice, the trail — none of which the person who approved
            // the ask ever saw. Letting the approval satisfy both would file a
            // `checkin.decision` for a question nobody was asked. Governance never
            // silently invents a decision, for the same reason it never silently
            // drops one.
            error = true;
            result =
              `tool '${toolName}' was not executed and cannot be retried this turn: it declares ` +
              `its own checkIn consent gate, that gate trips for these arguments, and a resumed ` +
              `dispatch has no second checkpoint to ask on. Answer without it, or finish. (To ` +
              `the agent's author: the middleware '${askedBy}' and the tool's checkIn ask ` +
              `different questions — one is the rule's, one is the tool's with the evidence ` +
              `pack attached — so approving one is not answering the other. Keep one gate for ` +
              `this tool: drop the tool's \`checkIn\`, or let \`onToolCall\` return allow() for ` +
              `tools that declare their own.)`;
          } else {
            const env = scope.$getEnv();
            const dispatched = await resolveCredentialAndExecute(
              scope,
              tool,
              toolName,
              rest.args,
              toolCallId,
              iteration,
              env,
            );
            result = dispatched.result;
            error = dispatched.error;
            // A ceiling-refused call RAN but must not advance a step (9.20.0);
            // its envelope — status 'invalid' plus any surviving declared
            // effects — is still picked up and judged below.
            stepToolRan =
              dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true;
            if (dispatched.executed === true && error !== true) {
              resumeEnvelope = dispatched.envelope;
            }
            // skip_step behind a middleware ask, approved (9.18.0): the
            // placeholder just landed — replace it with the authoritative
            // sentence BEFORE the chain's last word, the execute loop's
            // composition kept.
            if (deps.stepPlanFor && toolName === SKIP_STEP_TOOL_NAME && stepToolRan) {
              result = applySkipStep(scope, { args: rest.args, toolCallId, iteration });
            }
            // present behind a middleware ask, approved (9.22.0): same
            // overwrite the batch loop applies — the snapshot (or refusal)
            // replaces the placeholder before the chain's last word. A miss
            // is an errored call here too.
            if (deps.artifactStore && toolName === PRESENT_TOOL_NAME && stepToolRan) {
              const presented = await applyPresent(scope, {
                args: rest.args,
                toolCallId,
                iteration,
              });
              result = presented.text;
              if (!presented.ok) {
                error = true;
                stepToolRan = false;
              }
            }
            // The tool ran on this side of the pause, so the chain gets its
            // last word here too — a rule about results cannot be skipped by
            // routing a call through a human.
            if (dispatched.executed === true) {
              modelResult = await afterMoment(scope, {
                ...(tool && { tool }),
                toolName,
                toolCallId,
                iteration,
                args: rest.args,
                result,
                ...(error === true && { error: true }),
                history: [...(scope.history as readonly LLMMessage[])],
                ...(scope.runIdentity && { identity: scope.runIdentity }),
                ...(env.signal && { signal: env.signal }),
              });
            }
          }
        }

        // `modelResult` is only set where the after-tool moment ran; everywhere
        // else the two are the same value.
        if (modelResult === undefined) modelResult = result;
        // Placement then the truncation net — the batch loop's precedence,
        // kept on this door (a resumed result is as placeable as an inline
        // one; `stepToolRan` is exactly "ran clean").
        const askPlaced = await placeResults(
          scope,
          { toolName, toolCallId, iteration },
          { result, modelResult },
          stepToolRan,
        );
        const askCapped = capResults(toolName, askPlaced);
        modelResult = askCapped.modelResult;
        let askResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        // Step boundary (9.18.0) — a result finalized HERE is as final as one
        // from the batch loop; the answered call advances the pointer before
        // the push, exactly as it would have inline.
        if (deps.stepPlanFor && stepToolRan) {
          askResultStr += applyStepReturn(scope, { toolName, toolCallId, iteration });
        }
        // Typed tool effects (9.19.0) — a resumed call's envelope is judged
        // exactly as an inline one's (fresh single-call batch state).
        if (resumeEnvelope !== undefined) {
          const askTransition: TransitionBatchState = { losers: [] };
          askResultStr += applyToolEffects(
            scope,
            { toolName, toolCallId, iteration },
            resumeEnvelope,
            askTransition,
          );
          emitTransitionConflict(scope, iteration, askTransition);
        }
        const askHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: askResultStr, toolCallId, toolName },
        ];
        scope.history = askHistory;
        scope.lastToolResult = {
          toolName,
          result: askResultStr,
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        };
        appendBatchResult(scope, {
          toolName,
          result: askResultStr,
          toolCallId,
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result: askCapped.result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.agent.iteration_end', {
          turnIndex: 0,
          iterIndex: iteration,
          toolCallCount: 1,
          history: askHistory,
        });
        scope.iteration = iteration + 1;
        scope.pausedToolCallId = '';
        scope.pausedToolName = '';
        scope.pausedToolStartMs = 0;
        scope.pausedAsk = false;
        scope.pausedAskArgs = undefined;
        scope.pausedAskIndex = undefined;
        scope.pausedAskMiddleware = undefined;
        // Cleared ONLY when it was set: a later component-less pause in this
        // run must not inherit this ask's surface, and a run that never
        // carried one must not gain the key (byte-identical).
        if (answeredVia !== undefined) scope.pausedComponentId = undefined;
        return;
      }

      // ── Check-in decision path ───────────────────────────────────────
      // A check-in pause is discriminated by `scope.pausedCheckIn` (restored
      // from the checkpoint). The resume input is a `CheckInDecision`. On
      // APPROVE the tool executes NOW (it never ran at pause time — consent
      // comes BEFORE execute); on DECLINE a model-visible tool_result lands so
      // the agent adapts in-loop. The typed `checkin.decision` event fires
      // either way. Same iteration semantics as resume-after-askHuman.
      if (scope.pausedCheckIn === true) {
        const iteration = scope.iteration as number;
        const args = (scope.pausedCheckInArgs ?? {}) as Readonly<Record<string, unknown>>;
        // A check-in pause MUST be resumed with a CheckInDecision. A mis-wired
        // resume (a bare string, say) declines by default — a consequential
        // tool can never silently EXECUTE from a malformed resume.
        const decision: CheckInDecision = isCheckInDecision(input)
          ? input
          : checkInDeclined({ by: 'unknown', note: 'resume input was not a CheckInDecision' });

        // The registered component that COLLECTED this decision (9.24.0),
        // written at pause time only when the ask carried one. The decision
        // stays exactly what it was — a structured `CheckInDecision`, never
        // parsed from prose — and the record now says which surface asked.
        const answeredVia = scope.pausedComponentId as string | undefined;
        typedEmit(scope, 'agentfootprint.checkin.decision', {
          toolName,
          toolCallId,
          iteration,
          approved: decision.approved,
          by: decision.by,
          ...(decision.note !== undefined && { note: decision.note }),
          ...(answeredVia !== undefined && { componentId: answeredVia }),
        });

        let result: unknown;
        /** What the model reads — see the ask path above. */
        let modelResult: unknown;
        let error: boolean | undefined;
        /** Step-advance eligibility, judged by this path (a decline ran nothing). */
        let stepToolRan = false;
        /** The effects envelope the approved call returned (9.19.0). */
        let resumeEnvelope: ReadToolResultEnvelope | undefined;
        if (decision.approved) {
          const env = scope.$getEnv();
          const tool = lookupTool(toolName);
          const dispatched = await resolveCredentialAndExecute(
            scope,
            tool,
            toolName,
            args,
            toolCallId,
            iteration,
            env,
          );
          result = dispatched.result;
          error = dispatched.error;
          // Same ceiling law as the ask path: ran ≠ completed a step (9.20.0).
          stepToolRan =
            dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true;
          if (dispatched.executed === true && error !== true) {
            resumeEnvelope = dispatched.envelope;
          }
          // Consent moved the execution to this side of the pause; the rules
          // about results move with it.
          if (dispatched.executed === true) {
            modelResult = await afterMoment(scope, {
              ...(tool && { tool }),
              toolName,
              toolCallId,
              iteration,
              args,
              result,
              ...(error === true && { error: true }),
              history: [...(scope.history as readonly LLMMessage[])],
              ...(scope.runIdentity && { identity: scope.runIdentity }),
              ...(env.signal && { signal: env.signal }),
            });
          }
        } else {
          result = decision.note ? `declined by human: ${decision.note}` : 'declined by human';
        }

        if (modelResult === undefined) modelResult = result;
        // Placement then the truncation net — the batch loop's precedence.
        const decisionPlaced = await placeResults(
          scope,
          { toolName, toolCallId, iteration },
          { result, modelResult },
          stepToolRan,
        );
        const decisionCapped = capResults(toolName, decisionPlaced);
        modelResult = decisionCapped.modelResult;
        let decisionResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        // Step boundary (9.18.0) — an approved consequential step (a checkIn
        // tool CAN be a step's tool) advances on the resumed dispatch.
        if (deps.stepPlanFor && stepToolRan) {
          decisionResultStr += applyStepReturn(scope, { toolName, toolCallId, iteration });
        }
        // Typed tool effects (9.19.0) — an approved consequential call may
        // carry them too; judged exactly as inline.
        if (resumeEnvelope !== undefined) {
          const decisionTransition: TransitionBatchState = { losers: [] };
          decisionResultStr += applyToolEffects(
            scope,
            { toolName, toolCallId, iteration },
            resumeEnvelope,
            decisionTransition,
          );
          emitTransitionConflict(scope, iteration, decisionTransition);
        }
        const decisionHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: decisionResultStr, toolCallId, toolName },
        ];
        scope.history = decisionHistory;
        // Drives `on-tool-return` triggers, same as the execute path.
        scope.lastToolResult = {
          toolName,
          result: decisionResultStr,
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        };
        appendBatchResult(scope, {
          toolName,
          result: decisionResultStr,
          toolCallId,
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result: decisionCapped.result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
          ...(resumeEnvelope?.status !== undefined && { status: resumeEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.agent.iteration_end', {
          turnIndex: 0,
          iterIndex: iteration,
          toolCallCount: 1,
          history: decisionHistory,
        });
        scope.iteration = iteration + 1;
        // Clear ALL pause checkpoint fields (shared + check-in).
        scope.pausedToolCallId = '';
        scope.pausedToolName = '';
        scope.pausedToolStartMs = 0;
        scope.pausedCheckIn = false;
        scope.pausedCheckInArgs = undefined;
        // Cleared ONLY when it was set — see the ask path's twin note.
        if (answeredVia !== undefined) scope.pausedComponentId = undefined;
        return;
      }

      // ── Credential-consent decision path (8.6.0) ─────────────────────
      // Discriminated by `scope.pausedCredential`, restored from the checkpoint.
      //
      // The resume input is IGNORED, and that is the design rather than an
      // omission. The person's answer here is "I authorized it", not a result:
      // they consented at the identity provider, out of band. So resume asks
      // the provider again and, if it now issues, runs the tool that was
      // waiting — the same reasoning that gave the middleware-ask outcome union
      // no `result` arm. A human never writes a tool's answer.
      //
      // Still not authorized? `resolveCredentialAndExecute` returns the
      // URL-free refusal with `error: true` and reports the outstanding
      // consent; the loop carries on and a further attempt can pause afresh.
      if (scope.pausedCredential === true) {
        const iteration = scope.iteration as number;
        const args = (scope.pausedCredentialArgs ?? {}) as Readonly<Record<string, unknown>>;
        const env = scope.$getEnv();
        const tool = lookupTool(toolName);
        const dispatched = await resolveCredentialAndExecute(
          scope,
          tool,
          toolName,
          args,
          toolCallId,
          iteration,
          env,
        );
        const result = dispatched.result;
        const error = dispatched.error;
        let modelResult: unknown;
        if (dispatched.executed === true) {
          modelResult = await afterMoment(scope, {
            ...(tool && { tool }),
            toolName,
            toolCallId,
            iteration,
            args,
            result,
            ...(error === true && { error: true }),
            history: [...(scope.history as readonly LLMMessage[])],
            ...(scope.runIdentity && { identity: scope.runIdentity }),
            ...(env.signal && { signal: env.signal }),
          });
        }
        if (modelResult === undefined) modelResult = result;
        // Placement then the truncation net — the batch loop's precedence.
        const consentPlaced = await placeResults(
          scope,
          { toolName, toolCallId, iteration },
          { result, modelResult },
          dispatched.executed === true && error !== true && dispatched.ceilingRefused !== true,
        );
        const consentCapped = capResults(toolName, consentPlaced);
        modelResult = consentCapped.modelResult;
        let consentResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        // Step boundary (9.18.0) — a step tool that waited on 3LO consent
        // advances the moment its resumed dispatch really ran, clean. A
        // ceiling-refused result is not clean (9.20.0): the model holds no
        // data and was told to call again.
        if (
          deps.stepPlanFor &&
          dispatched.executed === true &&
          error !== true &&
          dispatched.ceilingRefused !== true
        ) {
          consentResultStr += applyStepReturn(scope, { toolName, toolCallId, iteration });
        }
        // Typed tool effects (9.19.0) — same judge as every other path.
        const consentEnvelope =
          dispatched.executed === true && error !== true ? dispatched.envelope : undefined;
        if (consentEnvelope !== undefined) {
          const consentTransition: TransitionBatchState = { losers: [] };
          consentResultStr += applyToolEffects(
            scope,
            { toolName, toolCallId, iteration },
            consentEnvelope,
            consentTransition,
          );
          emitTransitionConflict(scope, iteration, consentTransition);
        }
        const consentHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: consentResultStr, toolCallId, toolName },
        ];
        scope.history = consentHistory;
        scope.lastToolResult = {
          toolName,
          result: consentResultStr,
          ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
        };
        appendBatchResult(scope, {
          toolName,
          result: consentResultStr,
          toolCallId,
          ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result: consentCapped.result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
          ...(consentEnvelope?.status !== undefined && { status: consentEnvelope.status }),
        });
        typedEmit(scope, 'agentfootprint.agent.iteration_end', {
          turnIndex: 0,
          iterIndex: iteration,
          toolCallCount: 1,
          history: consentHistory,
        });
        scope.iteration = iteration + 1;
        // Clear ALL pause checkpoint fields (shared + credential).
        scope.pausedToolCallId = '';
        scope.pausedToolName = '';
        scope.pausedToolStartMs = 0;
        scope.pausedCredential = false;
        scope.pausedCredentialArgs = undefined;
        scope.pausedCredentialService = undefined;
        return;
      }

      // ── The `pauseHere` / `askHuman` path ────────────────────────────
      // Reached when none of the three decision pauses above claimed this
      // resume: a tool called `pauseHere()` / `askHuman()` from inside its own
      // `execute`, and the value the consumer supplies IS that tool's result —
      // this handler's contract since it was written.
      //
      // Which is why the after-tool moment runs here too (8.13.0). The tool RAN:
      // `pauseHere` throws from inside `execute`, so it started and may have done
      // half its work — the case `ToolResultContext.error` was written for. Its
      // before-tool chain already walked in the loop, so skipping the after half
      // left the ledger with an opening row and no closing one, and left every
      // `onToolResult` rule — redaction first among them — unapplied to the one
      // value a PERSON typed.
      // A pause of this kind exists to collect a value, and the value BECOMES
      // the tool's result. Resuming with nothing has two live readings — "the
      // person gave no answer" and "just carry on" — and the library does not
      // get to pick. Before 8.18.0 it picked the worst one silently: the
      // undefined answer became `content: undefined` on a `role: 'tool'`
      // message and the next turn died in the messages slot with an anonymous
      // TypeError. Refused here, at the top of the branch, so no middleware has
      // been told about a result that does not exist and the checkpoint is
      // still good — answer it and resume again.
      if (input === undefined) {
        throw new PauseAnswerRequiredError({ toolName, toolCallId });
      }
      const iteration = scope.iteration as number;
      const env = scope.$getEnv();
      const tool = lookupTool(toolName);
      const args = argsForPausedCall(scope, toolCallId);
      // No `error` flag: a human's answer is not a tool failure.
      const rawPauseResult = await afterMoment(scope, {
        ...(tool && { tool }),
        toolName,
        toolCallId,
        iteration,
        args,
        result: input,
        history: [...(scope.history as readonly LLMMessage[])],
        ...(scope.runIdentity && {
          identity: scope.runIdentity as {
            tenant?: string;
            principal?: string;
            conversationId: string;
          },
        }),
        ...(env.signal && { signal: env.signal }),
      });
      // A person's answer is measured too. The cap is about what one turn can
      // afford to carry, and a pasted transcript costs a window exactly as much
      // as a tool's rows do — which is also why PLACEMENT judges it: the
      // handler's contract makes the answer the tool's result, so a pasted
      // 500KB transcript is checked in as `tool-result/<tool>` and the model
      // routes the ticket.
      const pausePlaced = await placeResults(
        scope,
        { toolName, toolCallId, iteration },
        { result: input, modelResult: rawPauseResult },
        true,
      );
      const pauseCapped = capResults(toolName, pausePlaced);
      const modelResult = pauseCapped.modelResult;
      let resultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
      // Step boundary (9.18.0) — THE HITL step ("ask a human, then export"):
      // the tool paused mid-step, the person's answer IS its result, and the
      // completed step advances here at the same boundary it would have
      // inline. The pointer itself crossed the checkpoint for free (it is
      // committed shared state); this is the half that has to be wired.
      if (deps.stepPlanFor) {
        resultStr += applyStepReturn(scope, { toolName, toolCallId, iteration });
      }
      const newHistory: LLMMessage[] = [
        ...(scope.history as readonly LLMMessage[]),
        {
          role: 'tool',
          content: resultStr,
          toolCallId,
          toolName,
        },
      ];
      scope.history = newHistory;
      // Drives `on-tool-return` triggers, same as every other dispatch path.
      scope.lastToolResult = { toolName, result: resultStr };
      appendBatchResult(scope, { toolName, result: resultStr, toolCallId });

      typedEmit(scope, 'agentfootprint.stream.tool_end', {
        toolCallId,
        // The REAL value the pause returned, not what a rule let the model read
        // — the same split the other four paths keep. Capped when a ceiling is
        // configured, because the marker IS the result on every channel.
        result: pauseCapped.result,
        durationMs: Date.now() - startMs,
      });
      typedEmit(scope, 'agentfootprint.agent.iteration_end', {
        turnIndex: 0,
        iterIndex: iteration,
        toolCallCount: 1,
        // Plain local array — see the matching note on the execute path.
        history: newHistory,
      });
      scope.iteration = iteration + 1;
      // Clear pause checkpoint fields.
      scope.pausedToolCallId = '';
      scope.pausedToolName = '';
      scope.pausedToolStartMs = 0;
      scope.pausedToolArgs = undefined;
    },
  };
}
