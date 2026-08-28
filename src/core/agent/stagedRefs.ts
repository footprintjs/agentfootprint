/**
 * core/agent/stagedRefs — the join between data staged BY REFERENCE and the
 * tool declared to spend it, composed into one sentence the model reads.
 *
 * ── The measured failure ────────────────────────────────────────────────────
 * A traced production run: four tool results carried real numbers, a compute
 * tool that could sum them was on the wire, and the app's prompt SAID to use
 * it — yet the model summed the four numbers in its head and stated the total.
 * The evidence gate recorded the truth ("appears in no tool result") and the
 * answer shipped anyway, because the posture only observed. The prose
 * instruction sat at the top of a long context; the numbers sat at the bottom.
 * Recency won.
 *
 * ── The intervention: say it LATE, from DECLARATIONS ────────────────────────
 * The library already holds both halves of the fix as data, no prose surface
 * needed:
 *
 *   • a placed tool result (`artifacts.placement` / `Tool.resultKind`) is a
 *     ticket in the conversation — `{ placed: true, ref, kind, … }` — naming
 *     data staged by reference;
 *   • a tool's `wants` (`{ arg: 'dataset/rows' }`) is the DECLARED promise
 *     that it spends refs of exactly that kind — matched by the same
 *     exact-string law the dispatch matcher uses, never by tool name.
 *
 * When both hold in one iteration, this module composes ONE short line naming
 * the refs and the spender tool, placed at the END of the request — beside the
 * data, where recency works for the instruction instead of against it. The
 * line is ephemeral (request assembly only, never history) and recomposed
 * each iteration, so it exists exactly while both conditions hold.
 *
 * The same join feeds the evidence correction: a revision that says "call the
 * tool that provides it" without naming WHICH tool over WHICH ref leaves the
 * model to head-math again.
 *
 * Pure functions, no scope, no events — the callers own delivery and record.
 */

import type { LLMMessage } from '../../adapters/types.js';
import { isPlacedToolResult } from '../../artifacts/placement.js';
import type { Tool } from '../tools.js';

/** One staged parcel a spender tool could be handed. */
export interface StagedRef {
  /** The artifact ref, verbatim — what the model passes as the argument. */
  readonly ref: string;
  /** The minted kind — the exact string a `wants` declaration matched. */
  readonly kind: string;
}

/** The join: which refs are in this iteration's context, and which served
 *  tools declared `wants` over their kinds. Both lists are non-empty. */
export interface StagedRefsMatch {
  /** Distinct matched refs, oldest first, capped at {@link MAX_NUDGE_REFS}. */
  readonly refs: readonly StagedRef[];
  /** Matched refs beyond the cap — stated rather than silently dropped. */
  readonly refsOmitted: number;
  /** The spender tools' REGISTERED names, capped at {@link MAX_NUDGE_TOOLS}. */
  readonly tools: readonly string[];
}

/** Most refs one nudge line names. Bounded so a fan-out that staged fifty
 *  parcels cannot turn the one-line nudge into a page. */
export const MAX_NUDGE_REFS = 6;

/** Most spender tools one nudge line names. */
export const MAX_NUDGE_TOOLS = 3;

/**
 * Harvest `Tool.wants` from the declared catalog — the `toolGrounding`
 * harvest verbatim, and with the same caveat: ToolProvider-DELIVERED tools
 * are invisible here (`list(ctx)` is opaque and per-iteration), so a provider
 * tool declaring `wants` arms nothing. The runtime check stays correctly
 * scoped on its own: the join below intersects this map with the tools the
 * current call actually serves.
 */
export function toolWantsOf(
  registryByName: ReadonlyMap<string, Tool>,
): ReadonlyMap<string, readonly string[]> {
  const map = new Map<string, readonly string[]>();
  for (const [name, tool] of registryByName) {
    if (tool.wants === undefined) continue;
    const kinds = [...new Set(Object.values(tool.wants))];
    if (kinds.length > 0) map.set(name, kinds);
  }
  return map;
}

/**
 * The join itself: scan the conversation for placed tickets whose `kind` a
 * currently-served `wants` tool declares, by the exact-string law the
 * dispatch matcher uses. Returns `undefined` unless BOTH sides hold — no
 * staged ref, or no served spender for any staged kind, means no match and
 * the caller composes nothing.
 *
 * A `role: 'tool'` message carrying a placed result holds the ticket as JSON
 * (`placedToolResult` is what wrote it); anything that does not parse to the
 * ticket shape is an ordinary result and is skipped without a sound.
 */
export function findStagedRefs(
  messages: readonly LLMMessage[],
  toolWants: ReadonlyMap<string, readonly string[]>,
  servedToolNames: ReadonlySet<string>,
): StagedRefsMatch | undefined {
  const spendersByKind = new Map<string, string[]>();
  for (const [name, kinds] of toolWants) {
    if (!servedToolNames.has(name)) continue;
    for (const kind of kinds) {
      const list = spendersByKind.get(kind);
      if (list === undefined) spendersByKind.set(kind, [name]);
      else if (!list.includes(name)) list.push(name);
    }
  }
  if (spendersByKind.size === 0) return undefined;

  const refs: StagedRef[] = [];
  const seenRefs = new Set<string>();
  const tools: string[] = [];
  let refsOmitted = 0;
  for (const message of messages) {
    if (message.role !== 'tool') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.content);
    } catch {
      continue;
    }
    if (!isPlacedToolResult(parsed)) continue;
    const kind = (parsed as { kind?: unknown }).kind;
    if (typeof kind !== 'string') continue;
    const spenders = spendersByKind.get(kind);
    if (spenders === undefined || seenRefs.has(parsed.ref)) continue;
    seenRefs.add(parsed.ref);
    if (refs.length < MAX_NUDGE_REFS) refs.push({ ref: parsed.ref, kind });
    else refsOmitted += 1;
    for (const name of spenders) if (!tools.includes(name)) tools.push(name);
  }
  if (refs.length === 0) return undefined;
  return { refs, refsOmitted, tools: tools.slice(0, MAX_NUDGE_TOOLS) };
}

/** Render the matched refs for a sentence: `'art_x' (dataset/rows), …`. */
function describeRefs(match: StagedRefsMatch): string {
  const rendered = match.refs.map((r) => `'${r.ref}' (${r.kind})`).join(', ');
  return match.refsOmitted > 0 ? `${rendered}, and ${match.refsOmitted} more` : rendered;
}

/** Render the spender tools: `` `compute` `` or `` `compute` or `chart` ``. */
function describeSpenders(tools: readonly string[]): string {
  return tools.map((t) => `\`${t}\``).join(' or ');
}

/**
 * The one late-positioned line (`nudge: true` on
 * `.namesAndNumbersFromEvidence()`). Appended at request assembly as the LAST
 * message of the iteration — never written to history — so the direction sits
 * beside the data instead of a thousand tokens above it.
 */
export function stagedRefsNudgeLine(match: StagedRefsMatch): string {
  return (
    `[staged data — this turn's tool results include data staged by reference: ` +
    `${describeRefs(match)}. Any derived number — a total, a sum, a difference, an average — ` +
    `must come from a tool result, not from your own arithmetic. To compute over the staged ` +
    `data, pass the ref string to ${describeSpenders(match.tools)} and report what it returns.]`
  );
}

/**
 * The refs sentence the evidence CORRECTION carries when the join holds at
 * recheck time (see `buildEvidenceCorrection`) — the same facts, spoken
 * inside the authored frame so the untrusted values still come last.
 */
export function stagedRefsTeachingClause(match: StagedRefsMatch): string {
  return (
    ` This turn staged data you can compute over: pass ${describeRefs(match)} to ` +
    `${describeSpenders(match.tools)} — compute the number there and answer with what it ` +
    `returns.`
  );
}
