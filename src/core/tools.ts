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
import {
  assertResultColumns,
  COLUMN_TYPES,
  type ColumnDeclaration,
  type ColumnType,
  type ToolResultColumns,
} from '../integrity/column-types/types.js';
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
  /**
   * THE ARTIFACT KIND A PLACED RESULT IS MINTED UNDER (9.70.0) — this tool's
   * result in the CONSUMER's vocabulary (`'dataset/rows'`), not the
   * framework's.
   *
   * Artifact PLACEMENT (`artifacts: { store, placement }`) checks an oversized
   * result into the store and hands the model a claim ticket. Absent this
   * field it mints under `tool-result/<toolName>` — honest, and unspendable:
   * `wants` is exact-match on kind BY LAW (no wildcards, no hierarchy), so a
   * downstream `wants: { dataset: 'dataset/rows' }` refuses the very ticket
   * the framework just minted, as a kind mismatch. Field-verified: the
   * consumer had to re-mint by hand at the seam, which is the framework
   * declining to carry its own ref.
   *
   * The fix is DECLARED, never inferred (the `capabilities` / `resultClass`
   * law) and never a loosening of the matcher: only the author knows what
   * their tool actually produces, and `wants` staying exact is what makes a
   * ticket a promise. Declaring `resultKind` makes the MINT speak the
   * consumer's vocabulary instead.
   *
   * A non-empty string; an empty or blank one is refused at `defineTool`,
   * because a kind is what a ticket is redeemed against and a blank kind
   * redeems against nothing. Omitted → exactly today's bytes
   * (`tool-result/<toolName>`, and no measurement at all without placement).
   *
   * @example a tool whose placed result a `wants` consumer can spend
   *   defineTool({
   *     name: 'get_rows',
   *     description: 'Fetch the rows of a dataset',
   *     resultKind: 'dataset/rows',
   *     inputSchema: { … },
   *     execute: async () => …,
   *   });
   *   // elsewhere: defineTool({ name: 'chart', wants: { dataset: 'dataset/rows' }, … })
   */
  readonly resultKind?: string;
  /**
   * WHAT THIS TOOL'S ROWS CONTAIN (9.78.0) — column name to type, the
   * sibling of {@link Tool.resultKind}. `resultKind` says what the result IS;
   * this says what it CONTAINS.
   *
   * THE MEASURED FAILURES, all three the same shape — a number became
   * something else, and nothing noticed at the seam:
   *
   *   1. `str(m.get("logical_unit_number") or "")` — LUN 0 is falsy, so LUN 0
   *      was stored as an EMPTY STRING on 2,094 mappings, and a host group
   *      missing the LUN an initiator probes first became indistinguishable
   *      from one that had it.
   *   2. `round(mib / 1024, 1)` rendered an 8 MiB disk as `0.0 GB`, which
   *      reads as NO DISK during a live incident.
   *   3. A family of tools returned their numbers as quoted strings
   *      (`"1240"`), which silently blanked every chart, because nothing
   *      downstream could tell a measure from a label.
   *
   * Declaring the columns gives the library something to check the rows
   * against. It catches 1 and 3. It cannot catch 2, and says so: the check
   * judges TYPE, never MEANING (see `COLUMN_TYPE_CEILING`, quoted verbatim
   * into every finding).
   *
   * A promise about what it NAMES, never a closed schema — an unlisted column
   * is allowed and never judged. Two spellings: a bare type, or the object
   * form when a column may legitimately hold nothing.
   *
   * ARMED BY TWO HALVES, like every write-seam check: this declaration AND
   * the operator's `checkColumnTypes` dial (default `'off'`). Omitted, or
   * with the dial off → exactly today's bytes; nothing is measured, no
   * finding is filed, and the model reads the rows the tool returned.
   *
   * @example the LUN report that lost its zeroes
   *   defineTool({
   *     name: 'host_group_mappings',
   *     description: 'The LUN mappings of a host group',
   *     resultKind: 'dataset/rows',
   *     resultColumns: {
   *       logical_unit_number: 'number',
   *       host_group: 'string',
   *       comment: { type: 'string', nullable: true },
   *     },
   *     inputSchema: { … },
   *     execute: async () => [{ logical_unit_number: 0, host_group: 'vdi-a' }],
   *   });
   */
  readonly resultColumns?: ToolResultColumns;
  /**
   * WHO OWNS THIS TOOL (9.60.0) — the identity edge, stamped at the one
   * moment the code demonstrably knows both ends: registration. Before
   * this field, ownership was only DERIVABLE (from the per-pass
   * InjectionRecord, or the maps kernel's MountedMap) — a checker asking
   * "who owns get_zones" between registration and the first tools-slot
   * pass had no answer, and a static `.tool()` registration's sourceId
   * was just the tool's own name. The Context Integrity checks read this
   * stamp and never infer identity; a tool without one is `unreachable`
   * to subject-joined checks, which the disposition ledger counts.
   * Omitted → exactly today's bytes (`source: 'registry'`).
   */
  readonly owner?: ToolOwner;
  /**
   * WHERE THIS TOOL'S ARGUMENTS COME FROM (9.60.0) — the names of tools
   * whose RESULTS ground what a caller passes here (`screen_fire` fires at
   * ids that `whats_here` listed). Declared by the author, never inferred:
   * only the author knows the dependency. The dangling-reference check
   * reads it at composition — when a declared ground's results have left
   * the window (`WindowRecord.droppedObservations`) and were not
   * re-established, offering this tool files a finding. Omitted → this
   * tool is never that check's subject, byte-identical.
   */
  readonly argumentsFrom?: readonly string[];
  /**
   * THE NAMED INGREDIENT TOOLS THIS TOOL IS COMPOSED OF (9.76.0) — the
   * registered tools its body calls through the run's own dispatch
   * (`ctx.tools`), declared by the author, never inferred.
   *
   * Consumer-side readers, which is what earns it a place here (the
   * `resultKind` / `argumentsFrom` law — a declaration rails read, nothing
   * that governs execution): the agent-build drift gate asserts every named
   * ingredient is a registered tool, so a runbook whose inventory tool was
   * renamed fails the BUILD by name instead of failing its first run; and it
   * joins the MCP `_meta` declaration list so a composed tool served over the
   * wire says what it is made of.
   *
   * Checked at AGENT BUILD, not at definition — the ingredients need not
   * exist before this tool is defined, and the catalog is only complete once
   * every `.tool()` registration has landed. Tools delivered by a
   * `ToolProvider` are invisible to the check (there is no build-time list);
   * with a provider configured the gate warns instead of refusing.
   * Omitted → nothing is checked, byte-identical.
   */
  readonly composedOf?: readonly string[];
  /**
   * WHETHER THIS TOOL'S PROCEDURE CAN RAISE AN APPROVAL GATE (9.76.0) — a
   * mid-run pause that asks a human before continuing. Declared, never
   * inferred (the `capabilities` law): the framework cannot see through a
   * tool boundary into an inner chart that gates.
   *
   * Consumer-side readers: composition-time checks that must refuse a gating
   * tool where a pause cannot be resumed (a fan-out branch — the runbook
   * grammar's compiler is the named reader). It does not govern execution;
   * the runtime pause refusal remains the backstop for a tool that omits it.
   * `false` is a declaration too ("this procedure never gates"), distinct
   * from saying nothing. Omitted → byte-identical.
   */
  readonly gates?: boolean;
  /**
   * FINGERPRINT THE REPEATED-CALL LEDGER ON ARGUMENTS ALONE (9.62.0) —
   * `'arguments'` tells `core/agent/repeatedCall.ts` that this tool's own
   * RESULT is not evidence of repetition and must not be folded into the
   * match key.
   *
   * The repeated-call nudge exists to catch a model calling the same tool
   * with the same arguments and getting nowhere. By default it proves "got
   * nowhere" by also requiring the RESULT to match — a `check status` call
   * returning a different status is progress, not a loop, and the default
   * rule (correctly) says nothing about it. That default quietly breaks for
   * a tool whose result is not a function of its arguments on purpose: a
   * screen/UI tool that stamps a fresh version number, timestamp, or cursor
   * into every answer so a human or a downstream cache can tell which
   * render is current. Call a tool like that twice with byte-identical
   * arguments and the default fingerprint never matches — the detector is
   * silently inert for it, forever. This was found in a real recorded
   * failure: an agent re-fired a completed navigation sequence and nothing
   * noticed, because each fire's fresh stamp made it look like new
   * information.
   *
   * Declared, never inferred — the `capabilities` / `resultClass` law. Only
   * the tool's author knows whether its result is signal or a stamp;
   * guessing from a name or a response shape would rest a detector on a
   * heuristic the framework cannot verify. The note's wording changes to
   * match when this fires (it stops claiming the result matched, because it
   * did not) — see `repeatedCall.ts` for both sentences.
   *
   * **This never suppresses execution.** The ledger only ever appends a
   * teaching sentence to a result the tool already returned, strictly AFTER
   * `execute` ran — the same anti-guarantee `runCheckpoint.ts` and
   * `Agent.ts` document for tool calls generally (durability replay,
   * resumed runs, and every retry of this kind still execute the tool; there
   * is no dedup here or anywhere else in this library).
   *
   * Omitted → byte-identical behavior: the ledger keeps folding the result
   * into the key exactly as it always has, for every tool that does not
   * declare this.
   *
   * @example a screen tool whose result always carries a fresh version stamp
   *   defineTool({
   *     name: 'render_screen',
   *     description: 'Render the named screen',
   *     repeatedWhen: 'arguments',
   *     inputSchema: { … },
   *     execute: async ({ view }) => `rendered ${view} @v${Date.now()}`,
   *   });
   */
  readonly repeatedWhen?: 'arguments';
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<TResult> | TResult;
}

/**
 * The stamped identity edge a tool carries (9.60.0): which subsystem it
 * belongs to, in the vocabulary the record already uses for sources.
 */
export interface ToolOwner {
  readonly kind: import('../events/types.js').ContextSource;
  readonly id: string;
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
  // Destructured through a fallback because this rule is also asked about
  // values NO COMPILER vetted — a `_meta` bag from a foreign MCP server
  // (`readToolExtras`). A `null` or a number must reach the teaching refusal
  // below, not blow up on the destructuring on the way to it.
  const { maxChars, narrowBy } = (ceiling ?? {}) as Partial<ToolResultCeiling>;
  if (!Number.isFinite(maxChars) || !Number.isInteger(maxChars) || (maxChars as number) <= 0) {
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

/**
 * The COLUMN-TYPE CONTRACT's rule and vocabulary, re-exported HERE.
 *
 * They are DEFINED in `src/integrity/column-types/types.ts`, because
 * `src/integrity/` is a strict leaf that imports nothing outside itself and
 * the check has to be able to read the words. They are re-exported here
 * because `defineTool` and the MCP ingest both reach for their rules through
 * `core/tools.ts` — one door for every declaration's rule, and no second copy
 * of any of them anywhere.
 */
export {
  assertResultColumns,
  COLUMN_TYPES,
  type ColumnDeclaration,
  type ColumnType,
  type ToolResultColumns,
};

/**
 * Refuse a `resultKind` that could never be redeemed, at definition time —
 * naming the tool and the fix (the `assertResultCeiling` / `assertResultClass`
 * law: a declaration this library cannot honor fails HERE, never at the first
 * oversized result of the first run). Exported beside them for consumers
 * assembling `Tool` objects by hand.
 *
 * The one rule is non-blankness, and it is not a formality: the kind is what a
 * `wants` argument is matched against by exact string equality, so a blank or
 * whitespace-only kind mints a ticket no declaration can ever name — the same
 * refusal `assertToolWants` raises on the consuming end, raised on the
 * producing end too. There is deliberately NO charset or shape rule: the kind
 * is the consumer's vocabulary, and the library does not own it.
 */
export function assertResultKind(toolName: string, resultKind: string | undefined): void {
  if (resultKind === undefined) return;
  if (typeof resultKind !== 'string' || resultKind.trim().length === 0) {
    throw new Error(
      `defineTool: tool '${toolName}' declares resultKind ${JSON.stringify(resultKind)}, which ` +
        `is not a kind anything could want. It is the artifact kind a PLACED result is minted ` +
        `under, matched by exact string equality against a consuming tool's ` +
        `\`wants\` (e.g. 'dataset/rows'), so a blank kind is a ticket no argument can redeem. ` +
        `Name the kind your consumers declare, or omit the field — omitting it mints ` +
        `\`tool-result/${toolName}\`, exactly as before.`,
    );
  }
}

/**
 * Refuse an `owner` stamp with a blank half, at definition time — naming the
 * tool and what a blank half would do.
 *
 * An identity edge with a blank half is worse than none: the Context Integrity
 * checks JOIN on it, so a blank `kind` or `id` joins the wrong subjects rather
 * than no subjects. Extracted from `defineTool` (9.71.0) so the MCP ingest
 * boundary can hold the SAME line on a declaration that arrived over the wire —
 * one rule, one message, two doors.
 *
 * Deliberately NOT a closed-set check on `kind`: the union is enforced by the
 * compiler for anyone calling `defineTool`, and the value is only ever read
 * into a prose reason (`owned by <kind> '<id>'`), never switched on.
 */
export function assertToolOwner(toolName: string, owner: ToolOwner | undefined): void {
  if (owner === undefined) return;
  // Same reason as `assertResultCeiling`: this is also asked about untyped
  // values from a foreign MCP server, so a scalar or a `null` must land on the
  // message rather than on a TypeError from the destructuring.
  const { kind, id } = (owner ?? {}) as Partial<ToolOwner>;
  if (
    typeof owner !== 'object' ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    typeof id !== 'string' ||
    id.length === 0
  ) {
    throw new Error(
      `defineTool('${toolName}'): \`owner\` must carry a non-empty kind and id — it is ` +
        `the identity edge integrity checks join on, and a blank half joins the wrong ` +
        `subjects. Got ${JSON.stringify(owner)}.`,
    );
  }
}

/**
 * Refuse an `argumentsFrom` edge that could never join, at definition time.
 *
 * The dangling-reference and unsupported-argument checks join on these names,
 * so a blank one — or a tool grounded by itself — would join the wrong subjects
 * or none at all. Extracted from `defineTool` (9.71.0) for the same reason as
 * {@link assertToolOwner}: the MCP ingest boundary enforces the identical rule
 * on a declaration a remote server sent.
 */
export function assertArgumentsFrom(
  toolName: string,
  argumentsFrom: readonly string[] | undefined,
): void {
  if (argumentsFrom === undefined) return;
  // The array check is part of the rule, not a formality: a foreign server can
  // put a bare string here, and `for…of` over one would walk its CHARACTERS
  // and refuse them one letter at a time.
  if (!Array.isArray(argumentsFrom) || argumentsFrom.length === 0) {
    throw new Error(
      `defineTool('${toolName}'): \`argumentsFrom\` must name at least one tool — ` +
        `omitting the field is how "no grounds" is said.`,
    );
  }
  for (const ground of argumentsFrom) {
    if (typeof ground !== 'string' || ground.length === 0) {
      throw new Error(
        `defineTool('${toolName}'): \`argumentsFrom\` entries must be non-empty tool ` +
          `names. Got ${JSON.stringify(ground)}.`,
      );
    }
    if (ground === toolName) {
      throw new Error(
        `defineTool('${toolName}'): \`argumentsFrom\` names the tool itself — a tool ` +
          `cannot be its own argument ground.`,
      );
    }
  }
}

/**
 * Refuse a `composedOf` list that could never be drift-checked, at definition
 * time — the {@link assertArgumentsFrom} law applied to composition: the
 * agent-build gate joins on these names, and a blank one — or a tool composed
 * of itself — would join the wrong subjects or none. The REGISTRATION check
 * (is every named ingredient actually registered?) deliberately does NOT
 * happen here: the ingredients need not exist before this tool is defined,
 * and only the agent build sees the complete catalog.
 */
export function assertComposedOf(
  toolName: string,
  composedOf: readonly string[] | undefined,
): void {
  if (composedOf === undefined) return;
  // Same reason as `assertArgumentsFrom`: this rule is also asked about
  // untyped values from a foreign MCP server, and `for…of` over a bare string
  // would walk its CHARACTERS.
  if (!Array.isArray(composedOf) || composedOf.length === 0) {
    throw new Error(
      `defineTool('${toolName}'): \`composedOf\` must name at least one ingredient tool — ` +
        `omitting the field is how "not composed" is said.`,
    );
  }
  for (const ingredient of composedOf) {
    if (typeof ingredient !== 'string' || ingredient.length === 0) {
      throw new Error(
        `defineTool('${toolName}'): \`composedOf\` entries must be non-empty tool names. ` +
          `Got ${JSON.stringify(ingredient)}.`,
      );
    }
    if (ingredient === toolName) {
      throw new Error(
        `defineTool('${toolName}'): \`composedOf\` names the tool itself — a tool cannot ` +
          `be its own ingredient.`,
      );
    }
  }
}

/**
 * Refuse a `gates` declaration that is not a boolean, at definition time.
 * Trivial for anyone the compiler vets; load-bearing at the MCP ingest
 * boundary, where a foreign server can put anything under the key and a
 * truthy string would silently declare a gate nobody wrote.
 */
export function assertGates(toolName: string, gates: boolean | undefined): void {
  if (gates === undefined) return;
  if (typeof gates !== 'boolean') {
    throw new Error(
      `defineTool('${toolName}'): \`gates\` must be a boolean — \`true\` (this tool's ` +
        `procedure can raise an approval gate), \`false\` (declared gate-free), or omitted ` +
        `(nothing declared). Got ${JSON.stringify(gates)}.`,
    );
  }
}

/** Options for one {@link ToolDispatch.call}. */
export interface ToolDispatchCallOptions {
  /** Abort signal for the inner call. Defaults to the outer call's own. */
  readonly signal?: AbortSignal;
  /**
   * Declare an inner ABSENCE survivable (9.76.0). By default a dispatch
   * consumer that composes answers (runbookAsTool) propagates an inner
   * `absent()` as its own answer — "the inventory found nothing" IS the
   * runbook's result, and pretending to a verdict over it would be the
   * confident-partial-answer failure. Pass `true` when the caller can carry
   * on without this source and will state the gap itself (usually as a
   * coverage entry). The raw dispatch delivered on `ctx.tools` returns every
   * result untouched either way — the propagation policy belongs to the
   * consumer that wraps it.
   */
  readonly allowAbsent?: boolean;
}

/**
 * The run's own tool dispatch, delivered at execute time as `ctx.tools`
 * (9.76.0) — how one tool's body calls ANOTHER registered tool through the
 * same map the model dispatches by, instead of importing its module and
 * building a second query stack.
 *
 * What it sees: the agent's static catalog (`.tool()` registrations plus
 * skill-carried tools) — the same dispatch map the tool-calls handler uses.
 * Tools delivered by a `ToolProvider` are NOT visible (there is no build-time
 * list), a stated caveat, not an accident.
 *
 * What an inner call gets: the outer call's own facts (credentials, signal,
 * progress) with `hasArtifacts: false` — an inner tool must not mint claim
 * tickets competing with the composed answer's own — and a derived
 * `toolCallId` naming the outer call it belongs to. A declared `needs` is
 * resolved before the inner execute (fail-closed: a service that requires
 * interactive consent refuses by name — an inner call cannot pause).
 */
export interface ToolDispatch {
  /** Is this name in the dispatch map? Provider-delivered tools answer false. */
  has(name: string): boolean;
  /**
   * Execute a registered tool and return its result exactly as returned —
   * a coverage envelope arrives as the envelope, an absence as the absence.
   */
  call(name: string, args: unknown, opts?: ToolDispatchCallOptions): Promise<unknown>;
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
  /**
   * The run's own tool dispatch (9.76.0) — see {@link ToolDispatch}. Present
   * on the agent's dispatch paths; ABSENT at doors with no dispatch map
   * (`mcpServe`, the offline trace context, a hand-built context in a test).
   * Absent and empty are different facts: branch on the absence rather than
   * optional-chaining past it, and prefer a fail-closed refusal (the
   * `credentials` law) when your tool cannot work without it.
   */
  readonly tools?: ToolDispatch;

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
   * **What a PERSON sees (9.54.0).** One call, two faces. The structured
   * payload rides to the record untouched, exactly as above — and the live
   * status surfaces (`agent.enable.liveStatus(...)`, `attachStatus`) now show
   * the report too, so a long call is no longer silent in the browser. Because
   * `payload` is yours and typed `unknown`, the display contract is narrow and
   * literal:
   *
   *   - A top-level **string field named `message`** is shown to the person
   *     VERBATIM, trimmed, cut at **120 characters** with the cut stated
   *     (`… (+N more)`). `message` is the field MCP's own progress
   *     notification uses; nothing else in the payload is read.
   *   - **Anything else** — no `message`, a non-string one, an empty one, a
   *     bare string payload — shows the generic line instead:
   *     `` `<toolName>` reported progress (N so far)… ``. Your payload is
   *     never pretty-printed into that sentence. A status line is prose, and
   *     a tool's JSON is not a sentence anyone wrote.
   *
   * So `ctx.progress({ done: 3, total: 12 })` keeps its numbers on the record
   * and says "reported progress (3 so far)" on screen; adding
   * `message: 'Hop 3 of 12'` puts your own words there instead — and keeps the
   * numbers. Consumers override the wording by template key
   * (`tool.progress`, `tool.progress.generic`, or per tool).
   *
   * Doors with no event stream to file on — `mcpServe`, the offline
   * `callTraceTool` context — supply the no-op. A tool must not have to know
   * which door it is behind to be safe to call this from.
   *
   * @example a twelve-hop walk that says where it is
   *   execute: async (args, ctx) => {
   *     for (const [i, hop] of hops.entries()) {
   *       await walk(hop);
   *       // `message` is what the person reads; the rest is what the record
   *       // keeps. Drop `message` and the screen still says a report landed.
   *       ctx.progress({
   *         message: `Hop ${i + 1} of ${hops.length} — ${hop.id}`,
   *         done: i + 1,
   *         total: hops.length,
   *         hop: hop.id,
   *       });
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
  /** The artifact kind a PLACED result is minted under, in the consumer's
   *  vocabulary (see {@link Tool.resultKind}). Omitted →
   *  `tool-result/<name>`, byte-identical. */
  readonly resultKind?: string;
  /** What this tool's ROWS contain — column name to type (see
   *  {@link Tool.resultColumns}). Needs the `checkColumnTypes` dial too.
   *  Omitted → nothing measured, byte-identical. */
  readonly resultColumns?: ToolResultColumns;
  /** The stamped identity edge — see {@link Tool.owner}. */
  readonly owner?: ToolOwner;
  /** The declared argument grounds — see {@link Tool.argumentsFrom}. */
  readonly argumentsFrom?: readonly string[];
  /** The named ingredient tools this tool calls through `ctx.tools` — see
   *  {@link Tool.composedOf}. Drift-checked at agent build, when the catalog
   *  is complete. Omitted → nothing checked, byte-identical. */
  readonly composedOf?: readonly string[];
  /** Whether this tool's procedure can raise an approval gate — see
   *  {@link Tool.gates}. Omitted → nothing declared, byte-identical. */
  readonly gates?: boolean;
  /** Fingerprint the repeated-call ledger on arguments alone, ignoring this
   *  tool's own result — see {@link Tool.repeatedWhen}. Omitted →
   *  byte-identical (the ledger keeps comparing results, as always). */
  readonly repeatedWhen?: 'arguments';
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
  // A placed-result kind nothing could want fails HERE too — not at the first
  // oversized result of the first run with placement configured.
  assertResultKind(options.name, options.resultKind);
  // A column type this library has no rule for fails HERE too — not at the
  // first rowset of the first armed run, where the symptom would be a check
  // that quietly judges nothing.
  assertResultColumns(options.name, options.resultColumns);
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
  // An identity edge with a blank half is worse than none: a checker would
  // join on it and compare the wrong subjects. Refused HERE, naming the tool.
  assertToolOwner(options.name, options.owner);
  // The grounds edge is judged at the same door and for the same reason: the
  // dangling-reference check joins on these names, and a blank one — or a
  // tool grounded by itself — would join the wrong subjects or none.
  assertArgumentsFrom(options.name, options.argumentsFrom);
  // Composition edges get the same shape discipline; the REGISTRATION check
  // (does every ingredient exist?) waits for the agent build, where the
  // catalog is complete.
  assertComposedOf(options.name, options.composedOf);
  assertGates(options.name, options.gates);
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
    ...(options.resultKind !== undefined && { resultKind: options.resultKind }),
    ...(options.resultColumns !== undefined && { resultColumns: options.resultColumns }),
    ...(options.owner !== undefined && { owner: options.owner }),
    ...(options.argumentsFrom !== undefined && { argumentsFrom: options.argumentsFrom }),
    ...(options.composedOf !== undefined && { composedOf: options.composedOf }),
    ...(options.gates !== undefined && { gates: options.gates }),
    ...(options.repeatedWhen !== undefined && { repeatedWhen: options.repeatedWhen }),
    execute: options.execute,
  };
}
