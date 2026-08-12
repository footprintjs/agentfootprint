/**
 * Tool types — Agent's tool-call contract.
 *
 * Pattern: Strategy (GoF) — each Tool is a strategy for "how to execute
 *          this named operation given these args".
 * Role:    Consumer-facing shape. Agent.tool(...) accepts these.
 * Emits:   N/A (types only).
 */

import { isDevMode } from 'footprintjs';

import type { LLMToolSchema } from '../adapters/types.js';
import type { Credential, CredentialNeed, CredentialProvider } from '../identity/types.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import type { CheckInDemand } from './checkin.js';
import type { TeardownOptions, TeardownScope } from './toolSessions.js';

/**
 * One executable tool the Agent can call.
 *
 * - `schema` is what the LLM sees (name, description, JSON schema).
 * - `execute` runs when the LLM requests this tool with the given args.
 *   Returns anything JSON-serializable; the framework forwards it back
 *   to the LLM as the tool result.
 */
export interface Tool<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly schema: LLMToolSchema;
  /** Declare-and-push: a credential this tool needs. The framework resolves it
   *  BEFORE invoking and injects `ctx.credential`; it is NOT in `schema`, so the
   *  LLM never sees or fills it. */
  readonly needs?: CredentialNeed;
  /**
   * Declarative demand for a human check-in BEFORE this tool runs — consent
   * for a consequential action, with an evidence pack riding the ask.
   * `'always'` trips on every call; a `(args, ctx) => boolean` predicate trips
   * selectively (e.g. only refunds over $1000). When it trips the tool-dispatch
   * loop pauses BEFORE execute and surfaces a `CheckInRequest`; the human
   * answers with `checkInApproved` / `checkInDeclined`. Omitted → byte-identical
   * behavior (no gate, no events, no pause). See `.checkIn()` on the Agent
   * builder to configure the evidence pack. Ordered AFTER the permission gate
   * and arg-validation, BEFORE credential resolution.
   *
   * Non-generic here (a `Tool` widens into `Tool[]` registries); `defineTool`
   * exposes a predicate typed to the tool's args at the CALL site.
   */
  readonly checkIn?: CheckInDemand;
  /**
   * Where this tool came from — the name of the MCP server that served it.
   *
   * **Absent means "this agent's own".** A tool you wrote with `defineTool`
   * carries nothing here, and that absence is the fact: nobody else supplied
   * it. A tool that arrived over MCP carries the client's `name`
   * (`mcpClient({ name: 'aws-mcp' })`), because the same tool NAME can come
   * from two servers and a policy that cannot tell them apart governs both.
   *
   * It travels to the decision point as `ToolMiddlewareContext.toolSource` —
   * the tool-dispatch chain and `mcpServe`'s serving-side chain read the same
   * field.
   *
   * Set by `mcpClient` / `mockMcpClient`. `defineTool` never sets it, so it
   * cannot be spoofed by accident; a hand-built `Tool` may set it deliberately
   * when it is genuinely relaying another source's tool.
   */
  readonly source?: string;
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<TResult> | TResult;
}

/** Runtime context passed to tool.execute(). */
export interface ToolExecutionContext {
  /** Unique id of THIS tool invocation (matches stream.tool_start.toolCallId). */
  readonly toolCallId: string;
  /** Current iteration number of the ReAct loop. */
  readonly iteration: number;
  /** Abort signal propagated from run({ env: { signal } }). */
  readonly signal?: AbortSignal;
  /**
   * The bound credential provider — the PULL escape hatch for dynamic needs.
   * Always present: when none is attached it's a fail-closed provider that
   * THROWS, so it never silently no-ops via optional chaining. Prefer the
   * declarative `needs` + `ctx.credential` for the common case.
   */
  readonly credentials: CredentialProvider;
  /** True when a real provider is attached. Branch on this for intentional
   *  degraded (no-credential) mode instead of relying on `undefined`. */
  readonly hasCredentials: boolean;
  /** The credential resolved for this tool's declared `needs` (declare-and-push).
   *  Present only when the tool declared a need and it resolved successfully. */
  readonly credential?: Credential;

  // ── Run / session identity (9.7.0) ────────────────────────────────────────
  // Three facts a tool needs to hold a session WITHOUT cross-binding it to the
  // next caller. All optional, all ABSENT rather than invented when the door
  // does not have them — absent and fabricated are different facts, and only
  // one of them is safe to key a live sandbox on.

  /**
   * The run this call belongs to.
   *
   * **Absent when there is no run.** A call served over `mcpServe` is one call,
   * not a turn in a conversation, and minting a synthetic run id there would
   * fabricate a run that never existed. Branch on the absence.
   */
  readonly runId?: string;

  /**
   * The hosting conversation this run is bound to, when it is bound to one —
   * `HostRequest.sessionId`, threaded through `agent.run({ sessionId })`.
   *
   * Never derived, never defaulted to `runId`, never the anonymous latch.
   *
   * **It is caller data, not identity.** Anyone who can reach the host can put
   * any string here, including someone else's. Never key a live session on it
   * alone — compose it with tenant and principal via {@link toolSessionKey}.
   */
  readonly sessionId?: string;

  /**
   * The identity the CALLER supplied — `run({ identity })`, the same tuple
   * memory and the permission gate scope on.
   *
   * **Absent when the caller passed none.** Deliberately NOT the run's internal
   * `runIdentity`, which is always populated (it defaults to
   * `{ conversationId: '<runId>' }`, or to `{ conversationId: sessionId }` on a
   * session-bound run since 9.10.0): handing either of those to a tool would
   * publish a SYNTHESIZED conversation as if somebody had named one. A tool
   * that wants the session has `ctx.sessionId` for it, which is the fact the
   * transport actually delivered.
   */
  readonly identity?: MemoryIdentity;

  /**
   * Register cleanup for work THIS call started — a code-interpreter session, a
   * browser context, a lease.
   *
   * The tool learns its isolation key at execute time and registers cleanup for
   * exactly that key in the same breath; there is no other seam where both are
   * in hand. Registering twice under one `(tool, scope, key)` is a no-op that
   * keeps the FIRST cleanup (it holds the live handle) and refreshes liveness,
   * so calling this on every execute is the intended shape for a reused
   * session.
   *
   * Throws, naming the door, when `scope` is not in {@link teardownScopes} — a
   * capability nobody implements is a promise the library cannot keep.
   *
   * @example a session that lives as long as the run
   *   const key = toolSessionKey(ctx, 'run');
   *   const session = await runner.start({ key });
   *   ctx.onTeardown?.(() => session.stop(), { scope: 'run', key });
   */
  onTeardown?(cleanup: () => void | Promise<void>, options?: TeardownOptions): void;

  /**
   * Which teardown scopes this door can actually honour — `[]` means none ever
   * fires here.
   *
   * A FACT to branch on, exactly like `hasCredentials`, rather than an
   * `undefined` to optional-chain past: a tool that wants a run-scoped session
   * needs to know it is talking to a door that has no runs BEFORE it opens one.
   */
  readonly teardownScopes?: readonly TeardownScope[];
}

/**
 * Internal: registry entry keyed by tool name.
 * Consumer never sees this shape.
 */
export interface ToolRegistryEntry {
  readonly name: string;
  readonly tool: Tool;
}

/**
 * Convenience input for `defineTool` — flatter than `Tool` itself.
 * Consumers describe the tool inline; the helper assembles `schema`.
 *
 * `inputSchema` is a JSON Schema object (the same one the LLM will
 * see). For tools that take no arguments, pass `{ type: 'object',
 * properties: {} }` or omit and we'll default to that.
 */
export interface DefineToolOptions<TArgs, TResult> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  /** Declare a credential this tool needs (declare-and-push). Resolved by the
   *  framework before `execute` and injected as `ctx.credential`. */
  readonly needs?: CredentialNeed;
  /** Demand a human check-in before this tool runs (see {@link Tool.checkIn}).
   *  `'always'` or a `(args, ctx) => boolean` predicate. */
  readonly checkIn?: CheckInDemand<TArgs>;
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<TResult> | TResult;
}

/**
 * Ergonomic builder for `Tool`. Equivalent to constructing an object
 * literal with `schema` + `execute`, but flatter and safer — the name
 * + description live alongside the executor so they can't drift.
 *
 * @example
 *   const weather = defineTool<{ city: string }, string>({
 *     name: 'weather',
 *     description: 'Get current weather for a city',
 *     inputSchema: {
 *       type: 'object',
 *       properties: { city: { type: 'string' } },
 *       required: ['city'],
 *     },
 *     execute: async ({ city }) => `${city}: 72°F sunny`,
 *   });
 *
 *   const agent = Agent.create({ provider }).tool(weather).build();
 */
/**
 * The tool-name charset every major LLM provider enforces (OpenAI, Azure OpenAI,
 * and Anthropic all require `^[a-zA-Z0-9_-]{1,64}$`). A name with a dot, space,
 * slash, colon, or >64 chars makes the provider 400-REJECT the WHOLE request — so
 * EVERY tool vanishes, not just the bad one, and it looks like "my tool isn't
 * visible." We validate at `defineTool` so a bad name fails LOUD here, naming the
 * offending tool, instead of as an opaque provider 400 at run time.
 */
const LLM_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * STRICT validation — throws a clear, actionable error if a tool name can't be
 * sent to an LLM. Exposed for consumers who want to fail hard (e.g. in a build
 * step or a test). The library itself only WARNS (see `warnIfInvalidToolName`),
 * because a name is provider-specific: a mock or a name-sanitizing custom provider
 * may accept dotted/namespaced names that OpenAI/Anthropic reject.
 */
export function assertValidToolName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `defineTool: tool name must be a non-empty string (got ${JSON.stringify(name)}).`,
    );
  }
  if (!LLM_TOOL_NAME_RE.test(name)) {
    const reason =
      name.length > 64
        ? `it is ${name.length} chars (max 64)`
        : `it contains characters outside [a-zA-Z0-9_-] (e.g. a dot, space, slash, or colon)`;
    throw new Error(
      `tool name ${JSON.stringify(name)} — ${reason}. ` +
        `LLM tool names must match /^[a-zA-Z0-9_-]{1,64}$/ (OpenAI, Azure, and Anthropic all ` +
        `400-reject the whole request otherwise, making every tool disappear). ` +
        `Rename it — e.g. replace '.', ':', '/', or ' ' with '_'.`,
    );
  }
}

/**
 * DEV-MODE heads-up (never throws): warns once-per-call if a tool name will be
 * rejected by OpenAI/Anthropic. Production and non-dev runs pay nothing. This is
 * the library's default guard (Convention: dev diagnostics warn, they don't throw)
 * — keeping mock/custom-provider + namespaced-name setups working. Reach for
 * `assertValidToolName` when you want a hard failure.
 */
export function warnIfInvalidToolName(name: unknown): void {
  if (!isDevMode()) return;
  try {
    assertValidToolName(name);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[agentfootprint] invalid ${(e as Error).message}`);
  }
}

export function defineTool<TArgs = Record<string, unknown>, TResult = unknown>(
  options: DefineToolOptions<TArgs, TResult>,
): Tool<TArgs, TResult> {
  warnIfInvalidToolName(options.name);
  return {
    schema: {
      name: options.name,
      description: options.description,
      inputSchema: options.inputSchema ?? { type: 'object', properties: {} },
    },
    ...(options.needs && { needs: options.needs }),
    // The call-site predicate is typed to TArgs; the stored Tool keeps the
    // non-generic shape so it widens into `Tool[]` registries.
    ...(options.checkIn !== undefined && { checkIn: options.checkIn as CheckInDemand }),
    execute: options.execute,
  };
}
