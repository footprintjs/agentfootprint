/**
 * agentCorePolicy — **RETIRED in 9.4.0.** The factory still exists and still
 * type-checks; calling it now refuses, by name, with the reason and the
 * alternatives. Nothing was removed from the public surface.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * This adapter dispatched `EvaluatePolicyCommand` against
 * `@aws-sdk/client-bedrock-agentcore`. **That command does not exist** — not in
 * 3.1066.0, not in any version, not under any other name. The AgentCore
 * data-plane client has no authorization-evaluation operation at all
 * (`EvaluateCommand` is there, but it scores agent transcripts against an
 * evaluator; it decides nothing about permissions). The policy surface is
 * **control-plane only**: you author and attach policies, and **AgentCore
 * enforces them AT THE GATEWAY**, in front of the tool, before any request
 * reaches your process.
 *
 * So every `check()` this adapter ever ran ended in the `catch` — and the
 * default is fail-closed, which means it denied every tool call and said the
 * policy engine was unreachable. It compiled, it passed its tests (all of which
 * injected `_client` past the SDK), and it could never have worked.
 *
 * ── Why a refusal rather than a deletion ────────────────────────────────────
 * Deleting an export breaks a build with a module-resolution error that
 * explains nothing. A factory that refuses breaks the same build with a
 * paragraph that names the mistake, the alternative, and where denials really
 * come from. The removal decision belongs to the next major.
 *
 * ── What to use instead ─────────────────────────────────────────────────────
 *   • **Local, in-process rules** — `PermissionPolicy.fromRoles(...)` behind
 *     the same `permissionChecker` port. Synchronous, so it doubles as a
 *     `gatedTools` predicate.
 *   • **Anything richer** — the `.toolMiddleware()` chain: allow / deny / ask /
 *     transform per call, with the run's own history in hand.
 *   • **AgentCore Gateway policy** — already enforced, without this library's
 *     help. A denial arrives as an **MCP error** on the tool call made through
 *     `mcpClient(...)`, and lands in the loop as the tool's result, which the
 *     model reads and adapts to. The library's job there is to surface that
 *     denial honestly, not to pre-evaluate a copy of the rule.
 *
 * The `PermissionChecker` port itself is untouched, and so is every local
 * policy built on it. A real AgentCore *data-plane* authorization API, if one
 * ever ships, plugs in behind that same port.
 */

import type { PermissionChecker } from '../types.js';

/**
 * What the policy engine answered.
 *
 * @deprecated 9.4.0 — kept so existing imports still compile. See the module
 * header: there is no AgentCore data-plane policy evaluation to answer.
 */
export interface AgentCorePolicyEvaluation {
  readonly decision: string;
  readonly reason?: string;
  readonly policyId?: string;
}

/**
 * The minimal surface the retired adapter called.
 *
 * @deprecated 9.4.0 — kept so existing imports still compile.
 */
export interface AgentCorePolicyClientLike {
  evaluate(input: {
    readonly policyStoreId: string;
    readonly principal: string;
    readonly action: string;
    readonly resource: string;
    readonly context?: Readonly<Record<string, unknown>>;
  }): Promise<AgentCorePolicyEvaluation>;
}

/**
 * What to do when the policy engine cannot be reached.
 *
 * @deprecated 9.4.0 — kept so existing imports still compile.
 */
export type AgentCorePolicyUnavailable = 'deny' | 'allow-with-warning';

/**
 * Options for the retired {@link agentCorePolicy}.
 *
 * @deprecated 9.4.0 — kept so existing imports still compile.
 */
export interface AgentCorePolicyOptions {
  readonly policyStoreId: string;
  readonly region?: string;
  readonly onUnavailable?: AgentCorePolicyUnavailable;
  readonly onWarning?: (message: string, error: Error) => void;
  readonly principalFor?: (
    identity: { readonly principal?: string; readonly tenant?: string } | undefined,
  ) => string;
  readonly name?: string;
  readonly cacheSize?: number;
  /** @internal */
  readonly _client?: AgentCorePolicyClientLike;
  /** @internal */
  readonly _sdk?: BedrockAgentCorePolicySdkModule;
}

/**
 * The slice of `@aws-sdk/client-bedrock-agentcore` the retired shim reached for.
 * `EvaluatePolicyCommand` is listed here as the record of a command that never
 * existed — see the module header.
 *
 * @deprecated 9.4.0 — kept so existing imports still compile.
 */
export interface BedrockAgentCorePolicySdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly EvaluatePolicyCommand?: new (input: unknown) => unknown;
}

/**
 * Raised by {@link agentCorePolicy}. Carries the whole explanation in
 * `message`; the class exists so a caller can catch this specific retirement
 * rather than pattern-matching prose.
 */
export class AgentCorePolicyRetiredError extends Error {
  readonly code = 'ERR_AGENTCORE_POLICY_RETIRED' as const;

  constructor() {
    super(
      `[security] agentCorePolicy() is retired (9.4.0) and cannot be constructed.\n` +
        `\n` +
        `  WHY. It dispatched EvaluatePolicyCommand against ` +
        `@aws-sdk/client-bedrock-agentcore, and that command does not exist in any\n` +
        `  version of that package. AgentCore has no data-plane "evaluate this ` +
        `permission" operation: policy is authored on the control plane and\n` +
        `  ENFORCED AT THE GATEWAY, in front of the tool. Every check this adapter ` +
        `ran therefore failed, and fail-closed turned that into a denial of\n` +
        `  every tool call. It could not have worked, and it should not keep ` +
        `pretending to.\n` +
        `\n` +
        `  INSTEAD, for rules you own:\n` +
        `    PermissionPolicy.fromRoles({ readonly: ['lookup'], admin: [...] }, 'readonly')\n` +
        `  passed as \`permissionChecker\` — the same port, decided in-process. For ` +
        `anything conditional (per-argument, per-sequence, ask-a-human), use the\n` +
        `  .toolMiddleware() chain, which sees the call and the history.\n` +
        `\n` +
        `  AND FOR GATEWAY POLICY: it is already being enforced without this ` +
        `library. A denial comes back as an MCP error on the tool call made\n` +
        `  through mcpClient(...), and reaches the model as that tool's result. ` +
        `Surfacing that honestly is the whole job — pre-evaluating a second copy\n` +
        `  of the rule in-process was never it.`,
    );
    this.name = 'AgentCorePolicyRetiredError';
  }
}

/**
 * **Retired (9.4.0).** Throws {@link AgentCorePolicyRetiredError} naming why,
 * what to use for local rules, and where Gateway-enforced denials actually
 * arrive. See the module header for the full story.
 *
 * @deprecated 9.4.0 — use `PermissionPolicy.fromRoles(...)` (local rules) or
 * `.toolMiddleware()` (conditional rules); AgentCore Gateway policy is enforced
 * at the Gateway and surfaces as an MCP error on the tool call.
 * @throws {AgentCorePolicyRetiredError} always.
 */
export function agentCorePolicy(_options: AgentCorePolicyOptions): PermissionChecker {
  throw new AgentCorePolicyRetiredError();
}
