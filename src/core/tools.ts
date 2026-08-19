/**
 * Tool types — Agent's tool-call contract.
 *
 * Pattern: Strategy (GoF) — each Tool is a strategy for "how to execute
 *          this named operation given these args".
 * Role:    Consumer-facing shape. Agent.tool(...) accepts these.
 * Emits:   N/A (types only).
 */

import { isDevMode } from 'footprintjs';

import type { LLMToolSchema, ToolCapability } from '../adapters/types.js';
import type { ToolArtifacts } from '../artifacts/capability.js';
import type { ArtifactMeta } from '../artifacts/types.js';
import { assertToolWants, type ToolWants } from '../artifacts/wants.js';
import type { Credential, CredentialNeed, CredentialProvider } from '../identity/types.js';
import type { MemoryIdentity } from '../memory/identity/types.js';
import { RESULT_CLASSES, type ToolResultClass } from '../lib/semantics/types.js';
import { assertAskComponent, type AskComponent } from './askComponent.js';
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
   * Declared artifact ARGUMENTS (9.22.0) — argument name → the artifact
   * `kind` it must resolve to (e.g. `wants: { dataset: 'dataset/rows' }`).
   *
   * The `needs` precedent applied to data: the MODEL passes the ~26-char
   * `art_…` ref as the argument (declare it `type: 'string'` in
   * `inputSchema`), and at dispatch — BEFORE `execute` — the framework
   * redeems it under the run's own scope and kind-checks the meta. The
   * handler receives the RESOLVED DATA in `args` (and the claim tickets on
   * `ctx.wanted`); a stale, unknown, or wrong-kind ref never reaches the
   * tool — the model reads a teaching refusal listing the live refs of the
   * wanted kind. Resolution rides `agentfootprint.artifacts.resolved`;
   * refusals ride `artifacts.refused` with `op: 'dispatch'`.
   *
   * **Whether the model MAY omit it is your `inputSchema`'s to say.** Name
   * the argument in `required` and dispatch refuses the call by name when no
   * ref arrives — the handler is never entered believing the framework
   * resolved something it did not. Leave it out and an omitted argument is
   * the model choosing not to use one: the tool runs, `args` carries no such
   * key, and `ctx.wanted` has no entry for it.
   *
   * Requires an attached store: an Agent refuses at BUILD when a statically
   * registered tool declares `wants` with no `artifacts` configured (config
   * that lies otherwise); other dispatch doors refuse at dispatch, by name.
   * Omitted → byte-identical behavior (nothing resolved, nothing measured).
   */
  readonly wants?: ToolWants;
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
   * Which REGISTERED screen component collects this tool's check-in decision
   * (9.24.0) — ids and props only, never markup. Rides the `CheckInRequest`
   * when the gate trips, so the answering screen renders its own registered
   * component instead of prose. Meaningless without `checkIn` and refused
   * beside its absence at `defineTool` — a component for a gate that never
   * fires is configuration that lies. A `propsRef` here must resolve in the
   * RUN's artifact scope when the gate trips (validated at raise time); a
   * check-in fires BEFORE `execute`, so the tool cannot mint it mid-call —
   * static declarations usually want inline `props`.
   */
  readonly checkInComponent?: AskComponent;
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
  /**
   * What this tool touches, DECLARED by whoever wrote it (9.11.0).
   *
   * The framework never infers this. A tool's capabilities are not knowable
   * from its name, its schema or its description, and classifying them by guess
   * would rest a policy decision on a heuristic — so a tool that says nothing
   * gets nothing asked about it, exactly as before.
   *
   * **Enforced when both sides speak.** When a tool declares a capability AND
   * the configured `PermissionChecker` declares it `governs` that capability,
   * the dispatch loop asks once per declared capability, right after the
   * `'tool_call'` check allows — `check({ capability: 'external_net', target:
   * '<tool name>' })`. Either side silent → not asked, not refused. A denial
   * lands like every other refusal in the loop: the tool does not run and the
   * model reads a result it can adapt to.
   *
   * @example a tool the operator wants governed as a network egress
   *   defineTool({
   *     name: 'fetch_invoice',
   *     description: 'Fetch an invoice PDF from the billing service',
   *     capabilities: ['external_net', 'user_data'],
   *     inputSchema: { … },
   *     execute: async ({ id }) => …,
   *   });
   */
  readonly capabilities?: readonly ToolCapability[];
  /**
   * The refusing ceiling on THIS tool's result (9.20.0): when the handler's
   * stringified return exceeds `maxChars`, the model reads a teaching refusal
   * naming the true size, the ceiling and how to narrow — and the oversized
   * payload never enters context, history or any event. See
   * {@link ToolResultCeiling} for why refusal, not truncation. Omitted →
   * byte-identical behavior (nothing measured, nothing emitted).
   */
  readonly resultCeiling?: ToolResultCeiling;
  /**
   * The declared CLASS of this tool's results (9.53.0) — what kind of answer
   * it gives (`'triage'` — a health/fault verdict; `'inventory'` — a
   * population listing). Declared, never inferred (the `capabilities` law),
   * and validated at definition against the closed set. The
   * `check:semantics` gate keys its per-class rules on it — a `'triage'`
   * tool whose sample result declares no coverage fails the build by name.
   * Omitted → no class rules; the semantic-envelope rules still apply to any
   * result that carries the `af_semantics` marker.
   */
  readonly resultClass?: ToolResultClass;
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<TResult> | TResult;
}

/**
 * A declared cap on ONE tool's result that REFUSES instead of truncating
 * (9.20.0).
 *
 * WHY refusal: a truncated result reads as a complete one — the model cannot
 * tell the data ends where the cut happened, so it fabricates from the part it
 * saw. A refusal that names the size, the ceiling and the parameters to narrow
 * produces a clean retry instead (field-verified on a ~191k-char return). The
 * agent-level `maxToolResultChars` remains the OTHER answer — truncate with a
 * verbatim head and a marker — for operators capping tools they did not write;
 * this one is the TOOL AUTHOR's contract, and only the author knows which
 * parameters (`narrowBy`) make the retry smaller.
 *
 * The record keeps the truth: a typed `agentfootprint.tools.result_refused`
 * event carries the true size, and the delivered result carries status
 * `'invalid'` so `onToolStatus` edges can route on it.
 */
export interface ToolResultCeiling {
  /** The ceiling, in characters of the stringified result. Positive whole
   *  number; anything else is refused at `defineTool`. */
  readonly maxChars: number;
  /** Parameter names the refusal suggests narrowing by (e.g. `['limit',
   *  'fields']`). Optional; when present it must name at least one — an empty
   *  list is refused, because omitting the field is how "no suggestions" is
   *  said. */
  readonly narrowBy?: readonly string[];
}

/**
 * Refuse a `resultCeiling` this library cannot honor, at definition time —
 * naming the tool and the fix, never failing at the first oversized result of
 * the first run. Exported beside {@link assertValidToolName} for consumers
 * assembling `Tool` objects by hand.
 */
export function assertResultCeiling(
  toolName: string,
  ceiling: ToolResultCeiling | undefined,
): void {
  if (ceiling === undefined) return;
  const { maxChars, narrowBy } = ceiling;
  if (!Number.isFinite(maxChars) || !Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error(
      `defineTool: tool '${toolName}' declares resultCeiling.maxChars = ${String(maxChars)}, ` +
        `which is not a positive whole number of characters. The ceiling is the size over ` +
        `which the model reads a refusal instead of the result — to have no ceiling, omit ` +
        `\`resultCeiling\` (absent means results are never measured, exactly as before).`,
    );
  }
  if (narrowBy !== undefined) {
    const usable =
      Array.isArray(narrowBy) &&
      narrowBy.length > 0 &&
      narrowBy.every((n) => typeof n === 'string' && n.trim().length > 0);
    if (!usable) {
      throw new Error(
        `defineTool: tool '${toolName}' declares resultCeiling.narrowBy = ` +
          `${JSON.stringify(narrowBy)}, which names nothing the refusal could suggest. ` +
          `List at least one parameter name (non-empty strings, e.g. ['limit', 'fields']), ` +
          `or drop the field — omitting it is how "no suggestions" is said.`,
      );
    }
  }
}

/**
 * Refuse a `resultClass` outside the closed set, at definition time — naming
 * the tool, the value and the whole vocabulary (the `assertResultCeiling`
 * law: a declaration this library cannot honor fails HERE, never at the
 * first gate run of the first CI pipeline). Exported beside it for consumers
 * assembling `Tool` objects by hand.
 */
export function assertResultClass(
  toolName: string,
  resultClass: ToolResultClass | undefined,
): void {
  if (resultClass === undefined) return;
  if (!RESULT_CLASSES.includes(resultClass)) {
    throw new Error(
      `defineTool: tool '${toolName}' declares resultClass '${String(resultClass)}', which is ` +
        `not a class this library has. The classes are: ${RESULT_CLASSES.join(', ')} — each ` +
        `carries a rule \`check:semantics\` can prove ('triage'/'inventory' results must ` +
        `declare coverage). To declare no class, omit the field (the semantic-envelope rules ` +
        `still apply to any result carrying the af_semantics marker).`,
    );
  }
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
  /**
   * The claim-check store, bound to THIS run's scope (9.21.0) — shaped
   * exactly like `credentials`. Always present: with no store attached every
   * method throws a teaching refusal naming how to attach one
   * (`Agent.create({ ..., artifacts })`), so a missing store can never read
   * as an empty one. The scope (tenant/principal/conversation) is composed by
   * the framework from the run's identity/session and closed over — a tool
   * cannot name, widen, or replace it. `put` stamps `origin`
   * (`{ runId, toolCallId }`) from the run's own facts.
   */
  readonly artifacts: ToolArtifacts;
  /** True when a real artifact store is attached. Branch on this for an
   *  intentional no-store (degraded) mode instead of catching the refusal. */
  readonly hasArtifacts: boolean;
  /**
   * The claim tickets behind this call's resolved `wants` arguments (9.22.0)
   * — argument name → the `ArtifactMeta` whose data replaced the ref in
   * `args`. Present ONLY when the tool declared `wants` and at least one
   * declared argument resolved; absent otherwise (absent and empty are
   * different facts). The data itself is already in `args`.
   */
  readonly wanted?: Readonly<Record<string, ArtifactMeta>>;
  /** The credential resolved for this tool's declared `needs` (declare-and-push).
   *  Present only when the tool declared a need and it resolved successfully. */
  readonly credential?: Credential;

  // ── Progressive results (9.52.0) ──────────────────────────────────────────

  /**
   * Report progress from INSIDE a long-running tool — "hop 3 of 12 done", said
   * mid-`execute`, while the call is still running.
   *
   * A tool call is otherwise ATOMIC on the record: `stream.tool_start` fires,
   * the handler runs for as long as it runs, and `stream.tool_end` carries the
   * result. For a forty-second twelve-hop walk that is one long silence — the
   * person watching cannot tell working from hung, and neither can an operator
   * reading the archive afterwards.
   *
   * Each call files one `agentfootprint.stream.tool_progress` event, in call
   * order, BEFORE this call's `tool_end`. The framework stamps `toolCallId`,
   * `toolName` and `iteration`: identity facts are never the tool's to state,
   * so a report cannot claim to be from another call. `payload` is the tool
   * author's own data, forwarded untouched.
   *
   * **Always present, never fatal.** With nothing listening it is a no-op that
   * drops the report; it never throws, never blocks (nothing is awaited), and
   * never changes what `execute` returns or what the model reads. A tool that
   * calls it zero times behaves exactly as it did before this existed.
   *
   * **`payload` must survive `structuredClone`** — it rides the ordinary emit
   * channel into every event sink and every recording, so plain data only (no
   * class instances, no live handles, no functions). Progress is TELEMETRY: it
   * never enters the tool result, the history, or the model's view.
   *
   * Doors with no event stream to file on — `mcpServe`, the offline
   * `callTraceTool` context — supply the no-op. A tool must not have to know
   * which door it is behind to be safe to call this from.
   *
   * @example a twelve-hop walk that says where it is
   *   execute: async (args, ctx) => {
   *     for (const [i, hop] of hops.entries()) {
   *       await walk(hop);
   *       ctx.progress({ done: i + 1, total: hops.length, hop: hop.id });
   *     }
   *     return summary;
   *   }
   */
  progress(payload: unknown): void;

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
  /** Declare artifact arguments: arg name → required artifact kind (see
   *  {@link Tool.wants}). The model passes the `art_…` ref; the framework
   *  resolves it before `execute` and the handler reads the data. */
  readonly wants?: ToolWants;
  /** Demand a human check-in before this tool runs (see {@link Tool.checkIn}).
   *  `'always'` or a `(args, ctx) => boolean` predicate. */
  readonly checkIn?: CheckInDemand<TArgs>;
  /** The registered screen component that collects the check-in decision
   *  (see {@link Tool.checkInComponent}). Requires `checkIn`. */
  readonly checkInComponent?: AskComponent;
  /** Declare what this tool touches (see {@link Tool.capabilities}). Consulted
   *  only when the configured checker declares it governs them. */
  readonly capabilities?: readonly ToolCapability[];
  /** Refuse (never truncate) a result over this many chars, teaching the model
   *  to narrow (see {@link ToolResultCeiling}). Omitted → byte-identical. */
  readonly resultCeiling?: ToolResultCeiling;
  /** The declared class of this tool's results — `'triage'` or `'inventory'`
   *  (see {@link Tool.resultClass}). Keys the `check:semantics` per-class
   *  rules. Omitted → no class rules. */
  readonly resultClass?: ToolResultClass;
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
  // A ceiling that cannot cap fails HERE, naming the tool — not at the first
  // oversized result of the first run.
  assertResultCeiling(options.name, options.resultCeiling);
  // A class outside the closed set fails HERE too — not at the first
  // `check:semantics` run of the first CI pipeline.
  assertResultClass(options.name, options.resultClass);
  // A decision component for a gate that never fires is configuration that
  // lies — configured-and-inert looks exactly like configured-and-working
  // (the `.checkIn({ scorer })`-with-minimal-evidence precedent). And a
  // malformed one fails HERE, naming the tool, not at the first tripped gate
  // of the first consequential call.
  if (options.checkInComponent !== undefined) {
    if (options.checkIn === undefined) {
      throw new Error(
        `defineTool('${options.name}'): \`checkInComponent\` has no effect without \`checkIn\`. ` +
          `The component rides the check-in ask — which screen collects the decision — and ` +
          `this tool declares no check-in, so it would never be shown to anyone. Declare ` +
          `\`checkIn: 'always'\` (or a predicate), or drop the component.`,
      );
    }
    assertAskComponent(options.checkInComponent, `defineTool('${options.name}') checkInComponent`);
  }
  // A wants-arg the schema never offers (or offers as a non-string) fails
  // HERE too, naming the argument — not as a ref that never arrives. Judged
  // against the RESOLVED schema: an omitted inputSchema defaults to empty
  // properties, which offers no argument for any ref to arrive through.
  assertToolWants(
    options.name,
    options.wants,
    options.inputSchema ?? { type: 'object', properties: {} },
  );
  return {
    schema: {
      name: options.name,
      description: options.description,
      inputSchema: options.inputSchema ?? { type: 'object', properties: {} },
    },
    ...(options.needs && { needs: options.needs }),
    ...(options.wants !== undefined && { wants: options.wants }),
    // The call-site predicate is typed to TArgs; the stored Tool keeps the
    // non-generic shape so it widens into `Tool[]` registries.
    ...(options.checkIn !== undefined && { checkIn: options.checkIn as CheckInDemand }),
    ...(options.checkInComponent !== undefined && { checkInComponent: options.checkInComponent }),
    // Copied verbatim, never inferred — an empty array is a tool that declared
    // it touches nothing, which is a different statement from saying nothing.
    ...(options.capabilities !== undefined && { capabilities: options.capabilities }),
    ...(options.resultCeiling !== undefined && { resultCeiling: options.resultCeiling }),
    ...(options.resultClass !== undefined && { resultClass: options.resultClass }),
    execute: options.execute,
  };
}
