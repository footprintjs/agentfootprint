/**
 * arguments/dispatch — the inputs layer's half of ToolCalls, in the ONE module
 * a plain agent never loads.
 *
 * Pattern: small helpers over the batch loop's own values — the layer's entry
 *          for a call (`argumentResolutions`), the arguments the call ran
 *          with, the rewrites a before-tool chain made — each returning the
 *          value the loop uses next.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). ToolCalls
 *          (`stages/toolCalls.ts`) loads this module through `import()` only
 *          when the layer is armed, or when a call's tool declares rules on an
 *          agent built without it — the optional-family law of docs-next's
 *          site budget (`scripts/check-site-budget.mjs`, the `findings/peel.ts`
 *          precedent). Imports nothing from `findings/` or `stages/`.
 * Emits:   N/A (one console warning per tool name on the fail-closed path).
 *
 * @example
 * ```ts
 * const inputs = deps.inputsLayer === true ? await import('../arguments/dispatch.js') : undefined;
 * const runArgs = inputs !== undefined ? inputs.withFills(args, resolution) : args;
 * ```
 */

import { changedArgKeys } from '../../toolShownArgs.js';
import type { Tool } from '../../tools.js';
import type { ToolArgs } from '../middleware/runChain.js';
import type { MiddlewareDecision } from '../middleware/types.js';
import { rulesOf } from './declare.js';
import type { ArgumentFill, ArgumentResolution } from './resolve.js';
import { filledNote, hidesArgument, unmountedRulesRefusal } from './serve.js';

/**
 * This batch's entries of `argumentResolutions`, by call id — only the entries
 * resolved for THIS iteration (`resolve.ts` stamps each with its batch's).
 */
export function resolutionsFor(
  scope: { readonly argumentResolutions?: readonly ArgumentResolution[] },
  iteration: number,
): ReadonlyMap<string, ArgumentResolution> {
  // Spread first: a TypedScope array read is a live deep-proxy view.
  const entries = [...(scope.argumentResolutions ?? [])];
  const byId = new Map<string, ArgumentResolution>();
  for (const entry of entries) {
    if (entry.iteration === iteration) byId.set(entry.toolCallId, entry);
  }
  return byId;
}

/** `args` with the entry's fills — a FRESH object; `args` itself when there are none. */
export function withFills(args: ToolArgs, resolution: ArgumentResolution | undefined): ToolArgs {
  const fills = resolution?.fills;
  if (fills === undefined || fills.length === 0) return args;
  const filled: Record<string, unknown> = { ...args };
  for (const fill of fills) filled[fill.argument] = fill.value;
  return filled;
}

/**
 * The entry's fills the call RAN with — each whose value is still the value on
 * the arguments the call ran with (`callArgs`, after the before-tool chain). A
 * middleware that rewrote a filled argument ran the call on ITS value, so a
 * clause naming the fill would tell the model the call ran with a value it did
 * not run with — a sentence a later path broke (honesty law 7). That clause is
 * omitted, never denied: the rewrite is on `middlewareDecisions`
 * (`changedKeys`), which the answer's standing and the "Assumed" block read.
 * Strict equality on purpose: the note prints the value, so it must be the
 * value that ran, byte for byte.
 */
export function fillsThatRan(
  resolution: ArgumentResolution | undefined,
  ranWith: ToolArgs,
): readonly ArgumentFill[] {
  const fills = resolution?.fills ?? [];
  return fills.filter((f) => ranWith[f.argument] === f.value);
}

/**
 * The past-tense note for a call that RAN on filled values (`serve.ts` ·
 * `filledNote`) — one clause per fill it really ran with (`fillsThatRan`), a
 * value the tool's view hides never printed. `''` when no fill ran.
 */
export function noteFor(
  toolName: string,
  tool: Tool | undefined,
  resolution: ArgumentResolution | undefined,
  ranWith: ToolArgs,
): string {
  const ran = fillsThatRan(resolution, ranWith);
  if (ran.length === 0) return '';
  return filledNote(
    toolName,
    ran.map((f) => ({
      argument: f.argument,
      value: f.value,
      hidden: hidesArgument(tool, f.argument, f.value),
    })),
  );
}

/**
 * The before-tool rows of one call's chain, each rewrite stamped with the
 * NAMES of the arguments it changed (`changedArgKeys` over its own
 * before/after — names only, never values).
 */
export function withChangedKeys(rows: readonly MiddlewareDecision[]): MiddlewareDecision[] {
  return rows.map((row) => {
    if (!row.changed || row.moment !== 'before-tool') return row;
    const before = row.before;
    const after = row.after;
    if (
      before === null ||
      typeof before !== 'object' ||
      after === null ||
      typeof after !== 'object'
    ) {
      return row;
    }
    const keys = changedArgKeys(before as ToolArgs, after as ToolArgs);
    return keys.length > 0 ? { ...row, changedKeys: keys } : row;
  });
}

/**
 * The rows a call's before-tool chain files: a RULED tool's rewrites carry
 * `changedKeys` (`withChangedKeys`) — the answer's standing reads a rewritten
 * ruled argument with no declared origin as assumed; every other tool's rows
 * as the chain wrote them.
 */
export function decisionsToRecord(
  tool: Tool | undefined,
  rows: readonly MiddlewareDecision[],
): readonly MiddlewareDecision[] {
  return rulesOf(tool) !== undefined ? withChangedKeys(rows) : rows;
}

const warnedUnmounted = new Set<string>();
const MAX_WARNED_UNMOUNTED = 500;

/**
 * FAIL CLOSED (adopted Q14): the sentence a call reads when its tool declares
 * argument rules and the agent was built without the inputs layer — and, once
 * per tool name, unconditionally (a refused call is not a style note), a
 * warning naming `.inputsLayer()`.
 */
export function unmountedRefusal(toolName: string): string {
  if (!warnedUnmounted.has(toolName)) {
    if (warnedUnmounted.size < MAX_WARNED_UNMOUNTED) warnedUnmounted.add(toolName);
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] tool '${toolName}' declares argument rules (askOrAssume / period), and ` +
        `this agent was built without the inputs layer — the tool reached the run through a ` +
        `ToolProvider, which the build cannot see. Its calls are REFUSED rather than run ` +
        `unruled. Build the agent with .inputsLayer() to apply the rules.`,
    );
  }
  return unmountedRulesRefusal(toolName);
}

/**
 * Forget every unmounted-rules warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-once.
 */
export function _resetUnmountedRulesWarnings(): void {
  warnedUnmounted.clear();
}
