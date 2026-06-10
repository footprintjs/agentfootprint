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
import type { ProviderToolCache } from '../../slots/buildToolsSlot.js';
import type { Tool } from '../../tools.js';
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

  return {
    execute: async (scope) => {
      const toolCalls = scope.llmLatestToolCalls as readonly {
        readonly id: string;
        readonly name: string;
        readonly args: Readonly<Record<string, unknown>>;
      }[];
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
          ...(hasThinking && { thinkingBlocks: thinkingBlocks as never }),
        });
      }
      // Resolve a tool by name. The Tools slot already invoked
      // `provider.list(ctx)` this iteration and cached the resolved
      // Tool[] in the closure-shared providerToolCache — read from
      // there to avoid a second discovery call (especially important
      // for async network-backed providers). Same iteration ctx →
      // same result, so the cache is correct.
      const lookupTool = (toolName: string): Tool | undefined => {
        const fromRegistry = registryByName.get(toolName);
        if (fromRegistry) return fromRegistry;
        if (!externalToolProvider) return undefined;
        const cached = providerToolCache?.current ?? [];
        return cached.find((t) => t.schema.name === toolName);
      };

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
        let denied = false;
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
          const verdict = validateToolArgs(tc.args, tool.schema.inputSchema);
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
              result = await tool.execute(tc.args, {
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
        const durationMs = Date.now() - startMs;
        typedEmit(scope, 'agentfootprint.stream.tool_end', {
          toolCallId: tc.id,
          result,
          durationMs,
          ...(error === true && { error: true }),
        });
        const resultStr = typeof result === 'string' ? result : safeStringify(result);
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
        if (tc.name === 'read_skill' && !error && !denied) {
          const requestedId = (tc.args as { id?: unknown }).id;
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
        history: scope.history,
      });
      scope.iteration = iteration + 1;
      return undefined; // explicit: no pause, flow continues to loopTo
    },
    resume: (scope, input) => {
      // Consumer-supplied resume input becomes the paused tool's result.
      // The subflow's pre-pause scope is restored automatically by
      // footprintjs 4.17.0 via `checkpoint.subflowStates`, so
      // `scope.history` and `scope.pausedToolCallId` read back cleanly
      // across same-executor AND cross-executor resume.
      const toolCallId = scope.pausedToolCallId as string;
      const toolName = scope.pausedToolName as string;
      const startMs = scope.pausedToolStartMs as number;
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
        history: scope.history,
      });
      scope.iteration = iteration + 1;
      // Clear pause checkpoint fields.
      scope.pausedToolCallId = '';
      scope.pausedToolName = '';
      scope.pausedToolStartMs = 0;
    },
  };
}
