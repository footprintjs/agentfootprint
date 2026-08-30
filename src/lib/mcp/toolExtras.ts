/**
 * toolExtras — agentfootprint's own tool DECLARATIONS, carried over MCP.
 *
 * A `Tool` is two different things at once. Half of it is EXECUTION — the
 * handler, the credential it needs, the human it wants to check in with. The
 * other half is DECLARATION — flat, inert facts about the tool that no code
 * runs and every consumer-side rail READS: where its arguments come from, what
 * kind of artifact its result is, who owns it, what class of answer it gives,
 * how big a result is too big.
 *
 * Over MCP only the execution half used to cross. A tool served by `mcpServe`
 * arrived at a client as a name, a description and an input schema, so every
 * rail that reads a declaration went quiet for it: the dangling-reference and
 * unsupported-argument checks never armed, placement minted
 * `tool-result/<name>` that no `wants` could spend, and the identity joins had
 * no subject. An MCP server could be somebody's whole tool catalogue and still
 * be a second-class citizen of every check this library ships.
 *
 * ── The carrier ─────────────────────────────────────────────────────────
 * MCP's own extensibility bag: `Tool._meta`, under ONE namespaced key
 * ({@link MCP_TOOL_EXTRAS_KEY}). `_meta` is declared on the spec's `Tool`
 * object (`@modelcontextprotocol/sdk` types it as
 * `z.record(z.string(), z.unknown()).optional()` on `ToolSchema`), so it
 * survives the SDK's own `tools/list` validation in both directions and needs
 * no new protocol, no side channel and no version negotiation. A server that
 * has never heard of agentfootprint sends no bag; a client that has never
 * heard of it ignores the key.
 *
 * ── What may travel, and the bar ────────────────────────────────────────
 * **A declaration a consumer-side check or rail reads; nothing that governs
 * execution.** Every field below passes it. `needs` (credentials), `checkIn`
 * (human consent) and the session hooks do NOT and never will: they govern how
 * a tool RUNS, and the tool runs on the server. Sending them would tell a
 * client to hold a gate that the only executor of the tool has already held,
 * or — worse — that nobody is holding at all. `mcpServe` already refuses to
 * serve a `checkIn` tool for exactly that reason; this list is the same law,
 * stated on the way out.
 *
 * ── The asymmetry that matters ──────────────────────────────────────────
 * SERVING validates nothing new: the tool was built by `defineTool`, which
 * already refused every malformed declaration at definition time.
 *
 * INGEST validates everything and THROWS NOTHING. A bag comes from a server
 * this process does not control, and one server's typo must not take down a
 * bulk register of forty tools. So each field is judged by the SAME rule
 * `defineTool` enforces (literally the same exported assert), and a field that
 * fails is warned about once — naming the server, the tool, the field and the
 * rule — and DROPPED. The tool still registers, without that one declaration.
 * That is the honest outcome: the rail it would have armed stays unarmed, and
 * the developer is told which rail and why.
 */

import {
  assertArgumentsFrom,
  assertComposedOf,
  assertGates,
  assertResultCeiling,
  assertResultClass,
  assertResultColumns,
  assertResultKind,
  assertToolOwner,
  type Tool,
  type ToolOwner,
  type ToolResultCeiling,
  type ToolResultColumns,
} from '../../core/tools.js';
import type { ToolResultClass } from '../semantics/types.js';

/**
 * The single `_meta` key every agentfootprint declaration travels under.
 *
 * Namespaced so it can never collide with another vendor's `_meta` entry, and
 * a CONSTANT so there is exactly one spelling in the codebase — the
 * `branchSegment.ts` precedent upstream: one owner of the grammar, and nobody
 * else may write the string.
 */
export const MCP_TOOL_EXTRAS_KEY = 'agentfootprint';

/**
 * The declarations that cross an MCP boundary — the plain-data half of a
 * `Tool`, in the shape the receiving side puts straight back onto a `Tool`.
 *
 * Every field is optional and ABSENT MEANS ABSENT: a tool that declares
 * nothing sends no bag at all, and a tool that declares two sends two keys,
 * never five with three empty placeholders. "Said nothing" and "said empty"
 * are different statements everywhere else in this library, and they are
 * different here.
 *
 * @see MCP_TOOL_EXTRAS_KEY for the `_meta` key it rides under.
 */
export interface McpToolExtras {
  /** Where this tool's arguments come from — see {@link Tool.argumentsFrom}.
   *  Arms the dangling-reference and unsupported-argument checks. */
  readonly argumentsFrom?: readonly string[];
  /** The artifact kind a PLACED result is minted under — see
   *  {@link Tool.resultKind}. What makes a placed result spendable by `wants`. */
  readonly resultKind?: string;
  /**
   * What this tool's ROWS contain (9.78.0) — see {@link Tool.resultColumns}.
   * Arms the write seam's `column-type-mismatch` and `missing-column` checks.
   *
   * It clears the bar this file states, and by the widest margin of the eight.
   * It is a flat, inert fact about the RESULT that a consumer-side check
   * reads; it governs nothing about how the tool runs, and the tool runs on
   * the server. It is also the field case for carrying declarations at all: a
   * remote catalogue of rowset tools is exactly where a numeric column
   * arriving as text goes unnoticed, because the consumer holding the chart
   * has no way to know what the producer meant. Leaving it behind would arm
   * the check for local tools and leave every MCP tool a second-class citizen
   * of it — the whole defect `toolExtras` was built to end.
   */
  readonly resultColumns?: ToolResultColumns;
  /** The identity edge integrity checks join on — see {@link Tool.owner}. */
  readonly owner?: ToolOwner;
  /** The declared class of this tool's results — see {@link Tool.resultClass}. */
  readonly resultClass?: ToolResultClass;
  /** The author's refusing ceiling on this tool's result — see
   *  {@link Tool.resultCeiling}. */
  readonly resultCeiling?: ToolResultCeiling;
  /** The named ingredient tools this tool is composed of (9.76.0) — see
   *  {@link Tool.composedOf}. Feeds the receiving agent's build-time drift
   *  gate. */
  readonly composedOf?: readonly string[];
  /** Whether this tool's procedure can raise an approval gate (9.76.0) — see
   *  {@link Tool.gates}. Read by composition-time checks that must keep a
   *  gating tool out of a fan-out branch. */
  readonly gates?: boolean;
}

/**
 * The declarations on `tool`, ready to be written into an MCP `_meta` bag —
 * or `undefined` when the tool declares none, so `mcpServe` can leave `_meta`
 * off the listing entirely rather than sending an empty object.
 *
 * Copied verbatim, never inferred or defaulted. This is the SERVE side, and
 * the values were already vetted by `defineTool`.
 */
export function toolExtrasOf(tool: Tool): McpToolExtras | undefined {
  const extras: McpToolExtras = {
    ...(tool.argumentsFrom !== undefined && { argumentsFrom: tool.argumentsFrom }),
    ...(tool.resultKind !== undefined && { resultKind: tool.resultKind }),
    ...(tool.resultColumns !== undefined && { resultColumns: tool.resultColumns }),
    ...(tool.owner !== undefined && { owner: tool.owner }),
    ...(tool.resultClass !== undefined && { resultClass: tool.resultClass }),
    ...(tool.resultCeiling !== undefined && { resultCeiling: tool.resultCeiling }),
    ...(tool.composedOf !== undefined && { composedOf: tool.composedOf }),
    ...(tool.gates !== undefined && { gates: tool.gates }),
  };
  return Object.keys(extras).length > 0 ? extras : undefined;
}

/** Where a rejected declaration came from, for the warning that names it. */
export interface McpToolExtrasOrigin {
  /** The client's logical name — `mcpClient({ name })`. */
  readonly server: string;
  /** The tool the bag was attached to. */
  readonly tool: string;
}

/**
 * Read an MCP `Tool._meta` bag into declarations a `Tool` can carry.
 *
 * **Never throws.** Everything here is somebody else's data:
 *
 *   - no `_meta`, no `agentfootprint` key, or a non-object under it → `{}`,
 *     and the ingest is byte-identical to every release before this existed;
 *   - a field the receiving side does not know → ignored in silence (a NEWER
 *     server talking to an OLDER client is not an error, and warning about it
 *     would make every upgrade noisy at the wrong end);
 *   - a field this library DOES know but cannot honour → warned once and
 *     dropped, and the rest of the bag still lands.
 *
 * The rule each field is judged by is the exported assert `defineTool` itself
 * calls, so a declaration that would have been refused at definition time is
 * refused here too, with the same sentence.
 */
export function readToolExtras(meta: unknown, origin: McpToolExtrasOrigin): McpToolExtras {
  const bag = bagOf(meta);
  if (bag === undefined) return {};
  const kept = (field: keyof McpToolExtras, assert: (value: unknown) => void): unknown =>
    keepField(bag, field, origin, assert);

  // One line per field, in the declaration order of `McpToolExtras` — a reader
  // comparing the two lists should not have to sort. The casts inside each
  // rule are the point of the exercise: the value is untyped until its own
  // rule has agreed it is the shape the field claims.
  const argumentsFrom = kept('argumentsFrom', (v) =>
    assertArgumentsFrom(origin.tool, v as readonly string[]),
  ) as readonly string[] | undefined;
  const resultKind = kept('resultKind', (v) => assertResultKind(origin.tool, v as string)) as
    | string
    | undefined;
  const resultColumns = kept('resultColumns', (v) => assertResultColumns(origin.tool, v)) as
    | ToolResultColumns
    | undefined;
  const owner = kept('owner', (v) => assertToolOwner(origin.tool, v as ToolOwner)) as
    | ToolOwner
    | undefined;
  const resultClass = kept('resultClass', (v) =>
    assertResultClass(origin.tool, v as ToolResultClass),
  ) as ToolResultClass | undefined;
  const resultCeiling = kept('resultCeiling', (v) =>
    assertResultCeiling(origin.tool, v as ToolResultCeiling),
  ) as ToolResultCeiling | undefined;
  const composedOf = kept('composedOf', (v) =>
    assertComposedOf(origin.tool, v as readonly string[]),
  ) as readonly string[] | undefined;
  const gates = kept('gates', (v) => assertGates(origin.tool, v as boolean)) as boolean | undefined;

  return {
    ...(argumentsFrom !== undefined && { argumentsFrom }),
    ...(resultKind !== undefined && { resultKind }),
    ...(resultColumns !== undefined && { resultColumns }),
    ...(owner !== undefined && { owner }),
    ...(resultClass !== undefined && { resultClass }),
    ...(resultCeiling !== undefined && { resultCeiling }),
    ...(composedOf !== undefined && { composedOf }),
    ...(gates !== undefined && { gates }),
  };
}

// ─── The reading, field by field ───────────────────────────────────

/** The bag under our key, or `undefined` when there is nothing to read. */
function bagOf(meta: unknown): Record<string, unknown> | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  const bag = (meta as Record<string, unknown>)[MCP_TOOL_EXTRAS_KEY];
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) return undefined;
  return bag as Record<string, unknown>;
}

/**
 * Judge ONE field and answer with the value to keep, or `undefined` to drop.
 *
 * The rule is passed IN rather than looked up here, so this function owns the
 * never-throw discipline and nothing else: every rule lives in `core/tools.ts`
 * where `defineTool` reads it, and there is no second copy of any of them in
 * this file.
 */
function keepField(
  bag: Record<string, unknown>,
  field: keyof McpToolExtras,
  origin: McpToolExtrasOrigin,
  assert: (value: unknown) => void,
): unknown {
  // `in` rather than a truthiness test: a server that sent the key holding a
  // `null` said something wrong and should hear about it, while a server that
  // never sent the key said nothing and should not.
  if (!(field in bag)) return undefined;
  const value = bag[field];
  if (value === undefined) return undefined;
  try {
    assert(value);
  } catch (error) {
    warnOnce(origin, field, error instanceof Error ? error.message : String(error));
    return undefined;
  }
  return value;
}

// ─── The warning ───────────────────────────────────────────────────

/**
 * Warn-once ledger, keyed by server + tool + field.
 *
 * ONCE because `.refresh()` re-lists the whole catalogue and an agent that
 * refreshes every minute would otherwise print the same complaint every
 * minute. Bounded because the key contains a remote server's tool names, and
 * an unbounded Set fed by a remote party is a memory leak with a hostname
 * attached — past the cap the warning simply repeats, which is the harmless
 * failure mode.
 */
const warned = new Set<string>();
const MAX_WARNED = 500;

/**
 * NOT gated on `isDevMode()`, unlike the tool-NAME warning next door.
 *
 * A dropped declaration is not a style note: it is a check that will not arm,
 * a placed result that will not be spendable, an identity join with no
 * subject — and the symptom is silence, which looks exactly like a rail that
 * ran and agreed. The precedent is `toolArgsValidation`'s uncompilable
 * `pattern`: an ingested declaration this library cannot honour is reported
 * unconditionally, once, and then ignored.
 */
function warnOnce(origin: McpToolExtrasOrigin, field: string, rule: string): void {
  const key = `${origin.server} ${origin.tool} ${field}`;
  if (warned.has(key)) return;
  if (warned.size < MAX_WARNED) warned.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `[agentfootprint] MCP server '${origin.server}' declared \`${field}\` on tool ` +
      `'${origin.tool}' in its _meta.${MCP_TOOL_EXTRAS_KEY} bag, and this library cannot ` +
      `honour it — the field was DROPPED and the tool registered without it, so whatever ` +
      `that declaration would have armed stays unarmed. The rule it broke: ${rule}`,
  );
}

/**
 * Forget every warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-ONCE, so a test
 *   proving the warning fires must be able to start from silence.
 */
export function _resetToolExtrasWarnings(): void {
  warned.clear();
}
