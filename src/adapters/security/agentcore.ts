/**
 * agentCorePolicy — AWS Bedrock **AgentCore Policy** adapter for the
 * {@link PermissionChecker} port (peer-dep `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { agentCorePolicy } from 'agentfootprint/security';
 *
 *   const agent = Agent.create({
 *     provider,
 *     model,
 *     permissionChecker: agentCorePolicy({ policyStoreId: process.env.POLICY_STORE_ID! }),
 *   }).build();
 *
 * Maps one port method onto one data-plane call: every attempted tool call
 * becomes a policy evaluation, and the returned decision becomes a
 * `PermissionDecision`. Nothing else.
 *
 * ── The three rules this adapter is written under ────────────────────────────
 *
 * **1. Fail closed.** A policy engine you cannot reach has not said yes. When
 * evaluation throws — network, credentials, a renamed field, a policy store
 * that does not exist — the decision is `deny`, and it says so in words a
 * human can act on. `onUnavailable: 'allow-with-warning'` is available for
 * teams rolling policy out gradually, and it is deliberately awkward to type,
 * because "we could not check, so we allowed it" is a sentence you should have
 * to write down on purpose.
 *
 * **2. The reason rides to the model AS DATA.** A denied tool call comes back
 * to the LLM as a `tellLLM` string, not as an exception. The model then
 * re-decides with the refusal in front of it, which is the difference between
 * an agent that says "I am not allowed to do that" and a run that dies.
 * Telemetry (`reason`) stays out of `tellLLM` — the model does not get taught
 * the shape of the rule space.
 *
 * **3. One evaluation per (tool, principal) per turn.** The ReAct loop can put
 * the same tool in front of the gate several times in one iteration; paying for
 * a round-trip each time buys nothing, because nothing between them could have
 * changed the answer. The cache key is the tool, the principal AND the
 * iteration, so the NEXT turn re-asks — a policy that changed mid-conversation
 * is honoured on the next turn rather than at the end of the run.
 *
 * ── Verification status, stated plainly ──────────────────────────────────────
 * **Contract-mapped and injection-tested.** Every AWS interaction is exercised
 * through the `_client` seam; no test in this repo reaches AWS, and none
 * pretends to. Confirm the command and field names against your installed
 * `@aws-sdk/client-bedrock-agentcore` — this adapter targets an
 * evaluate-a-request shape and is structured so the request → decision mapping
 * is unit-tested independently of the SDK. Real-cloud verification lands with a
 * field deployment.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load. Role: Layer-3 cross-cutting
 * guard, exactly where `PermissionPolicy` sits — this one just asks somebody
 * else.
 */

import { lazyRequire } from '../../lib/lazyRequire.js';
import type { PermissionChecker, PermissionDecision, PermissionRequest } from '../types.js';

/** What the policy engine answered. */
export interface AgentCorePolicyEvaluation {
  /**
   * The engine's verdict. Compared case-insensitively against `'allow'`;
   * ANYTHING else is a denial, including a value this adapter has never seen.
   * An unrecognised verdict is not a permission.
   */
  readonly decision: string;
  /** Why, when the engine explains itself. Surfaces to the model on a denial. */
  readonly reason?: string;
  /** Which policy decided, for the audit trail. */
  readonly policyId?: string;
}

/**
 * The minimal surface this adapter calls. The real SDK client is adapted to it
 * in one function below; tests inject a fake via `_client` and never touch AWS.
 */
export interface AgentCorePolicyClientLike {
  evaluate(input: {
    readonly policyStoreId: string;
    /** Who is acting — the end user when the run carries one, else the agent. */
    readonly principal: string;
    /** What they are trying to do — the tool name for a tool call. */
    readonly action: string;
    /** What they are trying to do it to — the capability being exercised. */
    readonly resource: string;
    /** Everything else the policy may want to read. */
    readonly context?: Readonly<Record<string, unknown>>;
  }): Promise<AgentCorePolicyEvaluation>;
}

/** What to do when the policy engine cannot be reached or answers unintelligibly. */
export type AgentCorePolicyUnavailable = 'deny' | 'allow-with-warning';

/** Options for {@link agentCorePolicy}. */
export interface AgentCorePolicyOptions {
  /** The AgentCore policy store to evaluate against. Required. */
  readonly policyStoreId: string;
  /** AWS region, when the adapter constructs the SDK client itself. */
  readonly region?: string;
  /**
   * What an evaluation FAILURE means. Default `'deny'` — fail closed.
   *
   * `'allow-with-warning'` allows the call and reports the failure through
   * `onWarning`, for a rollout where the policy store is not yet the source of
   * truth. It never applies to a successful evaluation that said no: an
   * explicit denial is always a denial.
   */
  readonly onUnavailable?: AgentCorePolicyUnavailable;
  /**
   * Called when `onUnavailable: 'allow-with-warning'` lets a call through.
   * Default: `console.warn`. Give it your logger so the allow-on-failure is
   * something an on-call engineer can find later.
   */
  readonly onWarning?: (message: string, error: Error) => void;
  /**
   * Derive the policy principal from the run's identity. Default:
   * `identity.principal`, else `identity.tenant`, else `'agent'`.
   *
   * The default is also the cache key, so a checker shared across users never
   * hands one user's decision to another.
   */
  readonly principalFor?: (
    identity: { readonly principal?: string; readonly tenant?: string } | undefined,
  ) => string;
  /** Stable name, surfaced on permission events. Default `'agentCorePolicy'`. */
  readonly name?: string;
  /** Most decisions to keep cached at once. Default 500. Oldest are evicted first. */
  readonly cacheSize?: number;
  /** @internal Test injection — skips the SDK require entirely. */
  readonly _client?: AgentCorePolicyClientLike;
  /** @internal Test injection — the AWS SDK module, to exercise the real shim with a fake SDK. */
  readonly _sdk?: BedrockAgentCorePolicySdkModule;
}

const DEFAULT_NAME = 'agentCorePolicy';
const DEFAULT_CACHE_SIZE = 500;

function defaultPrincipal(
  identity: { readonly principal?: string; readonly tenant?: string } | undefined,
): string {
  return identity?.principal || identity?.tenant || 'agent';
}

/**
 * A `PermissionChecker` backed by an AgentCore policy store.
 *
 * Composes with everything already in the box and knows about none of it. In
 * particular `gatedTools(...)` is a DIFFERENT layer and stays untouched: the
 * gate decides what the model is shown, this decides what actually runs, and
 * neither needs to be told the other exists. A tool hidden by a gate is never
 * evaluated (the model cannot call what it cannot see); a tool the gate shows
 * still has to get past the policy.
 *
 * @example  Fail closed (the default)
 *   permissionChecker: agentCorePolicy({ policyStoreId, region: 'us-west-2' })
 *
 * @example  Rolling policy out, with the allow-on-failure logged where you can find it
 *   agentCorePolicy({
 *     policyStoreId,
 *     onUnavailable: 'allow-with-warning',
 *     onWarning: (message, error) => logger.warn({ err: error }, message),
 *   });
 */
export function agentCorePolicy(options: AgentCorePolicyOptions): PermissionChecker {
  if (!options.policyStoreId) throw new Error(`agentCorePolicy requires 'policyStoreId'.`);

  const name = options.name ?? DEFAULT_NAME;
  const onUnavailable = options.onUnavailable ?? 'deny';
  const principalFor = options.principalFor ?? defaultPrincipal;
  const cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  const warn =
    options.onWarning ??
    ((message: string) => {
      // eslint-disable-next-line no-console
      console.warn(message);
    });

  let client: AgentCorePolicyClientLike | undefined = options._client;
  // Insertion-ordered, so the oldest key is the first one `keys()` yields.
  const decisions = new Map<string, PermissionDecision>();

  function remember(key: string, decision: PermissionDecision): PermissionDecision {
    if (decisions.size >= cacheSize) {
      const oldest = decisions.keys().next().value;
      if (oldest !== undefined) decisions.delete(oldest);
    }
    decisions.set(key, decision);
    return decision;
  }

  return {
    name,
    async check(request: PermissionRequest): Promise<PermissionDecision> {
      const action = request.target ?? request.capability;
      const principal = principalFor(request.identity);
      // The iteration is IN the key on purpose: one evaluation per turn, and a
      // policy that changes mid-conversation takes effect on the next turn
      // rather than after the run.
      const key = `${principal} ${request.capability} ${action} ${
        request.identity?.conversationId ?? '-'
      } ${request.iteration ?? 0}`;
      const cached = decisions.get(key);
      if (cached) return cached;

      let evaluation: AgentCorePolicyEvaluation;
      try {
        client ??= createPolicyClient(options.region, options._sdk);
        evaluation = await client.evaluate({
          policyStoreId: options.policyStoreId,
          principal,
          action,
          resource: request.capability,
          context: {
            ...(request.context !== undefined && { arguments: request.context }),
            ...(request.iteration !== undefined && { iteration: request.iteration }),
            ...(request.identity?.tenant !== undefined && { tenant: request.identity.tenant }),
          },
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const detail =
          `[security] ${name} could not evaluate '${action}' for principal '${principal}': ` +
          `${error.message}.`;
        if (onUnavailable === 'allow-with-warning') {
          warn(
            `${detail} Allowing the call because onUnavailable is 'allow-with-warning' — ` +
              `this call was NOT authorized by policy.`,
            error,
          );
          return remember(key, {
            result: 'allow',
            policyRuleId: `${name}.unavailable.allowed`,
            rationale: detail,
            reason: 'policy:unavailable',
          });
        }
        // Fail closed. The model is told it is not allowed, and is deliberately
        // NOT told the policy engine is down — that is an operator's fact, and
        // handing it to a model invites it to argue with the outage.
        return remember(key, {
          result: 'deny',
          policyRuleId: `${name}.unavailable.denied`,
          rationale: `${detail} Denying, because a policy engine that did not answer did not say yes.`,
          reason: 'policy:unavailable',
          tellLLM: `Tool '${action}' is not available right now.`,
        });
      }

      // Anything that is not an explicit allow is a denial — a verdict this
      // adapter does not recognise is not a permission.
      const allowed = evaluation.decision.trim().toLowerCase() === 'allow';
      if (allowed) {
        return remember(key, {
          result: 'allow',
          policyRuleId: evaluation.policyId ?? `${name}.allow`,
        });
      }
      const why = evaluation.reason?.trim();
      return remember(key, {
        result: 'deny',
        policyRuleId: evaluation.policyId ?? `${name}.deny`,
        rationale: why ?? `Policy store denied '${action}' for principal '${principal}'.`,
        reason: 'policy:denied',
        // The refusal reaches the model as DATA so it can re-decide with the
        // reason in front of it, rather than as an exception that ends the run.
        tellLLM: why
          ? `Tool '${action}' was denied by policy: ${why}`
          : `Tool '${action}' is not permitted for this user.`,
      });
    },
  };
}

// ─── SDK shim (lazy require) ─────────────────────────────────────────

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCorePolicySdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly EvaluatePolicyCommand?: new (input: unknown) => unknown;
}

/**
 * Map {@link AgentCorePolicyClientLike} onto the real SDK command. If AWS
 * renames it, only this function changes — which is also why every test in this
 * repo injects past it.
 */
function createPolicyClient(
  region: string | undefined,
  injected?: BedrockAgentCorePolicySdkModule,
): AgentCorePolicyClientLike {
  let mod: BedrockAgentCorePolicySdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCorePolicySdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'agentCorePolicy requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `_client` for a pre-built or mock client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCorePolicy: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  if (!mod.EvaluatePolicyCommand) {
    throw new Error(
      'agentCorePolicy: `@aws-sdk/client-bedrock-agentcore` is missing EvaluatePolicyCommand. ' +
        'Upgrade the SDK, or pass `_client` with your own mapping.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });
  const Command = mod.EvaluatePolicyCommand;

  return {
    async evaluate(input) {
      const result = (await sdk.send(
        new Command({
          policyStoreId: input.policyStoreId,
          principal: input.principal,
          action: input.action,
          resource: input.resource,
          ...(input.context !== undefined && { context: input.context }),
        }),
      )) as { decision?: unknown; reason?: unknown; policyId?: unknown } | null;
      return {
        // A missing verdict is not an allow. See the `decision` docstring.
        decision: typeof result?.decision === 'string' ? result.decision : 'DENY',
        ...(typeof result?.reason === 'string' && { reason: result.reason }),
        ...(typeof result?.policyId === 'string' && { policyId: result.policyId }),
      };
    },
  };
}
