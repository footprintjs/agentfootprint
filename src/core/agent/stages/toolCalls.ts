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
import { isPauseRequest } from '../../pause.js';
import {
  shouldCheckIn,
  isCheckInDecision,
  checkInDeclined,
  type ResolvedCheckInConfig,
  type CheckInRequest,
  type CheckInDecision,
} from '../../checkin.js';
import type { ProviderToolCache } from '../../slots/buildToolsSlot.js';
import type { Tool } from '../../tools.js';
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
}

/**
 * Build the pausable tool-call handler for the agent's chart.
 */
export function buildToolCallsHandler(
  deps: ToolCallsHandlerDeps,
): PausableHandler<TypedScope<AgentState>> {
  const { registryByName, externalToolProvider, providerToolCache, permissionChecker } = deps;
  const toolArgValidation = deps.toolArgValidation ?? 'enforce';
  // Fail-closed: when no provider is attached, `ctx.credentials` is a provider
  // that THROWS on use (never undefined) — so a tool can't silently no-op.
  const credentials = deps.credentialProvider ?? unconfiguredCredentialProvider();
  const hasCredentials = deps.credentialProvider !== undefined;

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
   * Called from all three dispatch sites (the loop, an approved ask, an
   * approved check-in) and from nowhere else — every one of them has just
   * executed a tool, which is the entire precondition. A call the chain
   * denied, a call whose args were rejected, a call whose credential never
   * issued and a call still waiting on a person have no result, and asking a
   * rule about a result that does not exist would be the same fabrication the
   * outcome union removes.
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
        } else {
          typedEmit(scope, 'agentfootprint.credential.authorization_required', {
            service: need.credential,
            sessionId: cred.sessionId,
          });
          return {
            result: `authorization required for '${need.credential}': ${cred.authorizationUrl}`,
            error: true,
          };
        }
      } catch (credErr) {
        const reason = credErr instanceof Error ? credErr.message : String(credErr);
        typedEmit(scope, 'agentfootprint.credential.failed', { service: need.credential, reason });
        return { result: `credential error for '${need.credential}': ${reason}`, error: true };
      }
    }
    try {
      const result = await tool.execute(args, {
        toolCallId,
        iteration,
        ...(env.signal && { signal: env.signal }),
        credentials,
        hasCredentials,
        ...(resolvedCredential && { credential: resolvedCredential }),
      });
      return { result, executed: true };
    } catch (err) {
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
            // A checker that throws is treated as deny-by-default. The
            // denial message records the thrown error so consumers can
            // debug policy-adapter failures without losing the run.
            denied = true;
            const msg = permErr instanceof Error ? permErr.message : String(permErr);
            typedEmit(scope, 'agentfootprint.permission.check', {
              capability: 'tool_call',
              actor: 'agent',
              target: tc.name,
              result: 'deny',
              rationale: `permission-checker threw: ${msg}`,
            });
            result = `[permission denied: checker error: ${msg}]`;
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
          // The system prompt isn't in `scope.history` (the slots assemble it
          // separately) — reconstruct it from `systemPromptInjections` and
          // prepend a synthetic system frame so the evidence's `read` + the
          // `drivers` ranking can cite system RULES, not just the conversation.
          // Computed ONLY for a checkIn-declaring tool → zero cost otherwise.
          const systemPrompt = (
            (scope.systemPromptInjections as readonly InjectionRecord[] | undefined) ?? []
          )
            .map((r) => r.rawContent ?? '')
            .filter((s) => s.length > 0)
            .join('\n\n');
          const historyForEvidence: LLMMessage[] = systemPrompt
            ? [{ role: 'system', content: systemPrompt }, ...newHistory]
            : newHistory;
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
              } else {
                credentialBlocked = true;
                typedEmit(scope, 'agentfootprint.credential.authorization_required', {
                  service: need.credential,
                  sessionId: cred.sessionId,
                });
                result = `authorization required for '${need.credential}': ${cred.authorizationUrl}`;
              }
            } catch (credErr) {
              credentialBlocked = true;
              error = true;
              const reason = credErr instanceof Error ? credErr.message : String(credErr);
              typedEmit(scope, 'agentfootprint.credential.failed', {
                service: need.credential,
                reason,
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
                credentials,
                hasCredentials,
                ...(resolvedCredential && { credential: resolvedCredential }),
              });
            } catch (err) {
              if (isPauseRequest(err)) {
                // Commit partial state so resume() can find history intact.
                scope.history = newHistory;
                scope.pausedToolCallId = tc.id;
                scope.pausedToolName = tc.name;
                scope.pausedToolStartMs = startMs;
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
        let skillRejected = false;
        if (deps.allowedSkillIds && tc.name === 'read_skill' && !error && !denied) {
          const reqId = (callArgs as { id?: unknown }).id;
          if (typeof reqId === 'string' && reqId.length > 0) {
            const currentSkillId = scope.currentSkillId as string | undefined;
            const allowed = deps.allowedSkillIds(currentSkillId);
            if (!allowed.includes(reqId)) {
              skillRejected = true;
              result =
                `read_skill("${reqId}") is not reachable from here. ` +
                (allowed.length
                  ? `Reachable skills: ${allowed.join(', ')}. Pick one of these, or finish.`
                  : 'No skills are reachable from here — answer with the current skill, or finish.');
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
          if (rest.kind === 'deny') {
            result = rest.reason;
          } else if (tool?.checkIn !== undefined) {
            // Same one-question rule, from the other direction: this tool also
            // demands consent, and there is no checkpoint left to ask with.
            // Refusing loudly beats executing a tool whose consent gate we
            // silently skipped.
            error = true;
            result =
              `tool '${toolName}' also declares checkIn, and a resumed dispatch cannot pause ` +
              `again to ask a second time. The call was not executed — approve it through one ` +
              `gate, not both.`;
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

      const resultStr = typeof input === 'string' ? input : safeStringify(input);
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

      typedEmit(scope, 'agentfootprint.stream.tool_end', {
        toolCallId,
        result: input,
        durationMs: Date.now() - startMs,
      });
      const iteration = scope.iteration as number;
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
    },
  };
}
