/**
 * provider-contract/types — the Ports of the hexagonal architecture.
 *
 * Pattern: Adapter (GoF, Design Patterns ch. 4) + Ports-and-Adapters (Cockburn, 2005).
 * Role:    Contracts for every external dependency the library reaches for:
 *          LLM providers, memory stores, permission checkers, pricing tables.
 * Emits:   N/A (interfaces only).
 * Concrete adapters (AnthropicProvider, PineconeStore, PermissionPolicy, ...) implement
 * these contracts. `core/` and `core-flow/` depend only on them, never on an adapter.
 */

import type { ToolCallEntry } from './innerCalls.js';
import type { LLMMessage } from './types/message.js';
export type { ToolCallEntry } from './innerCalls.js';
export type { TypedAnswerMark } from './typedAnswerMark.js';
export type { ThinkingDeltaKind } from '../thinking/types.js';
export { DEFAULT_CARRIES_IN_MESSAGES, type WireRole } from './wireRole.js';

export type { LLMMessage } from './types/message.js';
export type { LLMRequest } from './types/request.js';
export type { LLMResponse, WireToolManifest, LLMChunk } from './types/response.js';
export type { ResilienceReport, LLMCallHooks, LLMProvider } from './types/provider.js';
export {
  STAGED_INPUTS_ENV,
  canStageCodeInputs,
  canReadCodeFiles,
  canRunCodeCommands,
  type BrowserShot,
  type BrowserDriver,
  type BrowserRunner,
  type BrowserSession,
  type CodeRunner,
  type CodeInput,
  type StagedCodeInput,
  type CodeSession,
  type CodeReadOptions,
  type CodeFile,
  type CodeCommandOptions,
  type CodeCommandResult,
  type CodeTruncation,
  type CodeResult,
} from './types/code.js';

export interface LLMToolSchema {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

// ─── Permission Engine ──────────────────────────────────────────────

/**
 * What a tool DECLARES it touches (9.11.0).
 *
 * The four values a tool can honestly say about itself. Deliberately a subset
 * of {@link PermissionCapability}: `'tool_call'` is the framework's own word for
 * "a tool was dispatched" and `'skill_read'` is the framework's word for "a
 * skill was activated" — neither is something a tool declares about its own
 * behaviour.
 *
 * **The framework never infers these.** A tool's capabilities are not knowable
 * from its name, its schema or its description; classifying them by guess would
 * put a policy decision on a heuristic. Declared or absent — see `Tool.capabilities`.
 */
export type ToolCapability = 'memory_read' | 'memory_write' | 'external_net' | 'user_data';

/**
 * The full vocabulary a {@link PermissionRequest} can carry.
 *
 * ## What is actually ENFORCED, said plainly
 *
 * `'tool_call'` has been enforced since v2.4: every tool dispatch asks the
 * checker before `tool.execute`. The rest are enforced **only when both sides
 * speak** (9.11.0):
 *
 * - a tool DECLARES `Tool.capabilities`, and
 * - the checker DECLARES {@link PermissionChecker.governs}.
 *
 * With either side silent, nothing extra is asked and nothing extra is refused
 * — byte-identical to every earlier release. This is deliberate: a framework
 * that started sending `'memory_write'` to existing fail-closed allowlists would
 * deny work those deployments have always permitted.
 *
 * **What is still NOT gated by this port, and is not pretended to be:** the
 * agent's own memory pipeline. Recall and write stages are scoped by
 * `MemoryIdentity` (tenant / principal / conversation), which is a
 * different mechanism from a permission check, and no memory stage builds a
 * `PermissionRequest`. So `'memory_read'` / `'memory_write'` reach a checker
 * only for a TOOL that declared them.
 */
export type PermissionCapability = ToolCapability | 'tool_call' | 'skill_read';

export interface PermissionRequest {
  /**
   * What kind of operation is being asked about. See
   * {@link PermissionCapability} for which values the framework actually sends
   * and when.
   */
  readonly capability: PermissionCapability;
  readonly actor: string;
  /**
   * What is being asked about, in the vocabulary of the capability:
   *
   * - `'tool_call'` and every {@link ToolCapability} — the TOOL NAME.
   * - `'skill_read'` — `skill:<id>` (9.11.0). Prefixed so a skill and a tool of
   *   the same name are two different subjects to a policy that lists ids.
   */
  readonly target?: string;
  readonly context?: Readonly<Record<string, unknown>>;
  /**
   * v2.12 — Sequence of tool calls already dispatched this run, in
   * call order. EMPTY for non-`tool_call` capabilities. Sequence-aware
   * policies (forbidden chains, idempotency limits) read this to make
   * decisions that single-call governance cannot.
   */
  readonly sequence?: readonly ToolCallEntry[];
  /**
   * v2.12 — Full conversation history at check time. Lets policies
   * inspect prior assistant content / tool results without maintaining
   * parallel state via event subscription.
   */
  readonly history?: readonly LLMMessage[];
  /**
   * v2.12 — Current ReAct iteration (1-based). Lets policies fire
   * different rules per iteration without external counters.
   */
  readonly iteration?: number;
  /**
   * v2.12 — Caller identity from `agent.run({ identity })`. Permission
   * predicates can role-check on `identity.principal` / `identity.tenant`.
   */
  readonly identity?: {
    readonly tenant?: string;
    readonly principal?: string;
    readonly conversationId: string;
  };
  /**
   * v2.12 — Optional abort signal propagated from `agent.run({ env: { signal } })`.
   * Async checkers (Redis lookups, hub-backed allowlists) MUST honor this
   * — when the agent run is cancelled, in-flight checks should abort.
   */
  readonly signal?: AbortSignal;
}

/**
 * v2.12 — content shape mirroring `LLMMessage.content`. Future-compatible
 * with multi-modal `tool_result` blocks once `LLMMessage` widens.
 */
export type ToolResultContent = string;

export interface PermissionDecision {
  /**
   * v2.12 — `'halt'` is NEW. Terminates the run cleanly with a typed
   * `PolicyHaltError`. The framework writes a synthetic `tool_result`
   * (using `tellLLM`) to `scope.history` BEFORE throwing, so:
   *   • Anthropic / OpenAI tool_use ↔ tool_result pairing is satisfied
   *   • The conversation history is consistent for `resumeOnError`
   *   • Lens / `getNarrative()` shows what the LLM was told
   *
   * `'deny'` keeps existing semantics: synthetic tool_result + LLM
   * continues and can pick differently.
   */
  readonly result: 'allow' | 'deny' | 'halt' | 'gate_open';
  readonly policyRuleId?: string;
  readonly rationale?: string;
  readonly gateId?: string;
  /**
   * v2.12 — telemetry tag (machine-readable, stable across versions).
   * Surfaces on `agentfootprint.permission.halt.reason` for routing
   * alerts (e.g. `'security:exfiltration'` → PagerDuty,
   * `'cost:context-bloat'` → Slack channel).
   */
  readonly reason?: string;
  /**
   * v2.12 — content for the synthetic `tool_result` on an explicit deny or halt.
   * A deny defaults to `"[permission denied: ${rationale ?? 'policy'}]"`. The
   * rationale can reach the model. A halt defaults to `"Tool '${name}' is not
   * available in this context."` Both defaults leave `reason` in telemetry.
   */
  readonly tellLLM?: ToolResultContent;
}

export interface PermissionChecker {
  readonly name: string;
  check(request: PermissionRequest): Promise<PermissionDecision> | PermissionDecision;
  /**
   * Which capabilities BEYOND `'tool_call'` this checker asks to be consulted
   * about (9.11.0). Optional and feature-detected — **absence is NO**.
   *
   * `'tool_call'` is always asked and needs no declaration. Everything else is
   * asked only when it appears here AND the other side declares it too:
   *
   * - a {@link ToolCapability} — asked once per declared capability, per
   *   dispatch of a tool whose `Tool.capabilities` names it, right after
   *   the `'tool_call'` check allows.
   * - `'skill_read'` — asked once per skill when the `read_skill` menu is
   *   composed (a refused skill's row disappears from what the model is
   *   offered) and again when the model activates one (a refused activation
   *   lands as the policy's own message, which the model reads and adapts to).
   *
   * The reason this exists rather than "just send everything": a checker
   * written before these values were sent is fail-closed by design, and would
   * deny a capability it has no rule for. Silence keeps such a checker doing
   * exactly what it does today. Declare it and the framework starts asking.
   *
   * @example a checker that also governs which skills a role may activate
   *   const checker: PermissionChecker = {
   *     name: 'my-policy',
   *     governs: ['skill_read'],
   *     check: (req) =>
   *       req.capability === 'skill_read' && req.target === 'skill:payroll'
   *         ? { result: 'deny', rationale: 'payroll is HR-only' }
   *         : { result: 'allow' },
   *   };
   */
  readonly governs?: readonly PermissionCapability[];
}

/**
 * Is this checker asked about `capability`? (9.11.0) `'tool_call'`: always, enforced since v2.4, no declaration needed. Anything else: only when the checker named it in `governs`; absence is NO.
 */
export function checkerGoverns(
  checker: PermissionChecker | undefined,
  capability: PermissionCapability,
): boolean {
  if (!checker) return false;
  return capability === 'tool_call' || checker.governs?.includes(capability) === true;
}
// ─── Pricing Table ──────────────────────────────────────────────────

export type TokenKind = 'input' | 'output' | 'cacheRead' | 'cacheWrite';

export interface PricingTable {
  readonly name: string;
  /** USD per ONE token for the given model+kind. */
  pricePerToken(model: string, kind: TokenKind): number;
}
