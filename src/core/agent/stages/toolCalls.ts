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

import type { PausableHandler, TypedScope } from 'footprintjs';
import type { LLMMessage, PermissionChecker } from '../../../adapters/types.js';
import type { ContextRole } from '../../../events/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { extractSequence } from '../../../security/extractSequence.js';
import type { ToolProvider } from '../../../tool-providers/types.js';
import type { Credential, CredentialProvider } from '../../../identity/types.js';
import { unconfiguredCredentialProvider } from '../../../identity/types.js';
import type { AuthorizationRequiredMode } from '../../../identity/consent.js';
import { CONSENT_PAUSE_KEY, consentQuestion, modelRefusal } from '../../../identity/consent.js';
import { isPauseRequest, PauseAnswerRequiredError } from '../../pause.js';
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
import {
  formatToolArgIssues,
  validateToolArgs,
  type ToolArgValidationMode,
} from '../toolArgsValidation.js';
import { safeStringify } from '../validators.js';
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
  /** Tool-args validation mode (#9). Default 'enforce': LLM-produced args
   *  are checked against the tool's `inputSchema` BEFORE dispatch; a
   *  mismatch rejects the call with a model-visible retry message.
   *  'warn' emits the event but executes anyway; 'off' skips validation. */
  readonly toolArgValidation?: ToolArgValidationMode;
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
  ): Promise<{ result: unknown; error?: boolean; executed?: boolean }> => {
    if (!tool) return { result: `Unknown tool: ${toolName}`, error: true };
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
        ...sessionContext(scope, toolName, toolCallId),
      });
      await endCall(toolCallId);
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
            // Returning a defined value triggers the footprintjs pause; the
            // returned object becomes the checkpoint's pauseData. detectPause
            // surfaces `pauseData.checkIn` as `outcome.checkIn`.
            return { toolCallId: tc.id, toolName: tc.name, checkIn: request };
          }
        }
        if (!denied && !argsRejected) {
          // Declare-and-push: resolve the tool's declared credential BEFORE
          // invoking, and inject it as ctx.credential. On consent-required or
          // failure, surface the reason to the LLM (tool result) + emit; the
          // tool does NOT run (fail-closed — never half-authed; a denial that
          // throws is surfaced, not retried).
          let resolvedCredential: Credential | undefined;
          let credentialBlocked = false;
          const need = tool?.needs;
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
          if (!credentialBlocked) {
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
                ...sessionContext(scope, tc.name, tc.id),
              });
              await endCall(tc.id);
            } catch (err) {
              if (isPauseRequest(err)) {
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
            }
          }
        }

        // ── The after-tool moment ────────────────────────────────────────
        // Last thing before the result becomes history, and only for a call
        // that ran. `modelResult` is what the model reads; `result` stays the
        // truth about the tool and is what `stream.tool_end` reports.
        const modelResult = executed
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

        const durationMs = Date.now() - startMs;
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId: tc.id,
          result,
          durationMs,
          ...(error === true && { error: true }),
        });
        const resultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
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
        //     this and activate any matching Instructions.
        scope.lastToolResult = { toolName: tc.name, result: resultStr };

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
        const decision: CheckInDecision = isCheckInDecision(input)
          ? input
          : checkInDeclined({ by: 'unknown', note: 'resume input was not a CheckInDecision' });

        let result: unknown;
        /** What the model reads. Differs from `result` only when a rule at the
         *  after-tool moment transformed or withheld it. */
        let modelResult: unknown;
        let error: boolean | undefined;
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
        const askResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        const askHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: askResultStr, toolCallId, toolName },
        ];
        scope.history = askHistory;
        scope.lastToolResult = { toolName, result: askResultStr };
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
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

        typedEmit(scope, 'agentfootprint.checkin.decision', {
          toolName,
          toolCallId,
          iteration,
          approved: decision.approved,
          by: decision.by,
          ...(decision.note !== undefined && { note: decision.note }),
        });

        let result: unknown;
        /** What the model reads — see the ask path above. */
        let modelResult: unknown;
        let error: boolean | undefined;
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
        const decisionResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        const decisionHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: decisionResultStr, toolCallId, toolName },
        ];
        scope.history = decisionHistory;
        // Drives `on-tool-return` triggers, same as the execute path.
        scope.lastToolResult = { toolName, result: decisionResultStr };
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
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
        const consentResultStr =
          typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
        const consentHistory: LLMMessage[] = [
          ...(scope.history as readonly LLMMessage[]),
          { role: 'tool', content: consentResultStr, toolCallId, toolName },
        ];
        scope.history = consentHistory;
        scope.lastToolResult = { toolName, result: consentResultStr };
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId,
          result,
          durationMs: Date.now() - startMs,
          ...(error === true && { error: true }),
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
      const modelResult = await afterMoment(scope, {
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
      const resultStr = typeof modelResult === 'string' ? modelResult : safeStringify(modelResult);
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

      typedEmit(scope, 'agentfootprint.stream.tool_end', {
        toolCallId,
        // The REAL value the pause returned, not what a rule let the model read
        // — the same split the other four paths keep.
        result: input,
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
