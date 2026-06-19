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
    execute: options.execute,
  };
}
