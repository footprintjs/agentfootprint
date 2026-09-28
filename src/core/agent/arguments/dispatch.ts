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

import type { TypedScope } from 'footprintjs';
import type { InputValue } from '../../inputRequest.js';
import { changedArgKeys } from '../../toolShownArgs.js';
import type { Tool } from '../../tools.js';
import type { ToolArgs } from '../middleware/runChain.js';
import type { MiddlewareDecision } from '../middleware/types.js';
import type { AgentState } from '../types.js';
import { isMissing, rulesOf } from './declare.js';
import { keptThisTurn, withKept, withoutUsed } from './kept.js';
import type { ArgumentFill, ArgumentResolution } from './resolve.js';
import {
  filledNote,
  hidesArgument,
  keptAnswersNote,
  secondPauseRefusal,
  unmountedRulesRefusal,
  type ServeOptions,
} from './serve.js';

/**
 * The refusal a call reads when the batch's one human question was the
 * layer's ask and the call needed a person again (`serve.ts` ·
 * `secondPauseRefusal`) — re-exported so ToolCalls reaches it through this
 * module's one `import()`.
 */
export { secondPauseRefusal };

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
 * KEPT ANSWERS, USED (honesty layer 2, step 4 — `kept.ts`): the
 * (tool, argument) pairs this batch's calls fill from an answer the turn kept
 * are dropped from `argumentAnswersKept` — a kept answer is used once. Called
 * before the batch ask merges its own answers, so a fill that is `answered`
 * here came from a kept answer and nothing else; a batch that fills none never
 * reads the key. A re-run after an interrupt finds them already dropped and
 * writes nothing.
 */
export function dropUsedKept(
  scope: TypedScope<AgentState>,
  resolutions: ReadonlyMap<string, ArgumentResolution>,
  calls: readonly { readonly id: string; readonly name: string }[],
): void {
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  const used: { toolName: string; argument: string }[] = [];
  for (const entry of resolutions.values()) {
    const toolName = nameOf.get(entry.toolCallId);
    if (toolName === undefined) continue;
    for (const fill of entry.fills ?? []) {
      if (fill.source === 'answered') used.push({ toolName, argument: fill.argument });
    }
  }
  if (used.length === 0) return;
  const turn = scope.turnNumber as number;
  const before = scope.$getValue('argumentAnswersKept') as unknown;
  const left = withoutUsed(before, turn, used);
  if ((left?.length ?? 0) === keptThisTurn(before, turn).length) return;
  scope.argumentAnswersKept = left;
}

/**
 * KEEP a refused call's answers (honesty layer 2, step 4 — `kept.ts`): in a
 * batch whose one human question was the inputs layer's ask, a call that
 * needed a person again was just refused — so the answered values it carried
 * (the batch ask's, or a kept one it filled from) are kept for the call the
 * model proposes next, which would otherwise leave the argument out and be
 * asked the same question again. Returns the argument names kept, for the
 * model's sentence (`keptNote`); nothing kept, nothing written.
 */
export function keepAnswers(
  scope: TypedScope<AgentState>,
  toolName: string,
  resolution: ArgumentResolution | undefined,
): readonly string[] {
  const answered = (resolution?.fills ?? []).filter((f) => f.source === 'answered');
  if (answered.length === 0) return [];
  scope.argumentAnswersKept = withKept(
    scope.$getValue('argumentAnswersKept') as unknown,
    scope.turnNumber as number,
    toolName,
    answered,
  );
  return answered.map((f) => f.argument);
}

/**
 * KEEP a refused call's answers and return the model's sentence for them
 * (`serve.ts` · `keptAnswersNote` over `keepAnswers`) — `''` when the call
 * carried no answer.
 */
export function keptNote(
  scope: TypedScope<AgentState>,
  toolName: string,
  resolution: ArgumentResolution | undefined,
): string {
  return keptAnswersNote(toolName, keepAnswers(scope, toolName, resolution));
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

/** The value the model's call carried for `argument` — `undefined` when it left it out. */
function carriedValue(proposed: ToolArgs | undefined, argument: string): InputValue | undefined {
  if (proposed === undefined || isMissing(proposed, argument)) return undefined;
  const value = proposed[argument];
  return typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;
}

/**
 * The past-tense note for a call that RAN on filled values (`serve.ts` ·
 * `filledNote`) — one clause per fill it really ran with (`fillsThatRan`), a
 * value the tool's view hides never printed. `proposed` is the call's own
 * arguments before the fills: an answered fill that REPLACED a value the call
 * carried (declared sources ask about an untraced value) says what the call
 * had carried; under declared sources (`options.sources`) an answered clause
 * also says a later call may cite the answer (`serve.ts` ·
 * `ANSWERED_SOURCE_CLAUSE`). `''` when no fill ran.
 */
export function noteFor(
  toolName: string,
  tool: Tool | undefined,
  resolution: ArgumentResolution | undefined,
  ranWith: ToolArgs,
  proposed?: ToolArgs,
  options?: ServeOptions,
): string {
  const ran = fillsThatRan(resolution, ranWith);
  if (ran.length === 0) return '';
  return filledNote(
    toolName,
    ran.map((f) => {
      const carried = f.source === 'answered' ? carriedValue(proposed, f.argument) : undefined;
      return {
        argument: f.argument,
        value: f.value,
        hidden: hidesArgument(tool, f.argument, f.value),
        ...(f.source === 'answered' && { source: 'answered' as const }),
        ...(carried !== undefined && { carried }),
      };
    }),
    options,
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
