import type { LLMToolSchema } from '../../provider-contract/types.js';
import type { FindingsAnswerAsk, FindingsServeMode } from '../../core/agent/findings/serve.js';
import type { OntologyRecord } from '../../ontology/types.js';

/** A committed tool list, or `undefined` when the key held no array — which is
 *  what makes it a FALLBACK CHAIN and not a merge: the first key that holds a
 *  list is the list this call served, and an empty array is an answer. */
export function toolListOf(value: unknown): LLMToolSchema[] | undefined {
  return Array.isArray(value) ? (value as LLMToolSchema[]) : undefined;
}

/** `toolWantsByName` back as the map `findStagedRefs` takes. It is committed
 *  as a plain record because a `Map` does not survive the scope's write path
 *  (an object write is JSON-round-tripped, and a `Map` round-trips to `{}`). */
/**
 * The serve mode `seed` put on the record (`findingsServe`), narrowed the way
 * every run constant is: only the one non-default literal changes anything,
 * and an absent or unrecognised value is the default the wire itself falls
 * back to (`callLLM.ts · buildCallLLMStage`, `deps.findingsServe ?? …`) — so
 * an unarmed run, which never wrote the key, collapses nothing.
 */
export function servedModeOf(value: unknown): FindingsServeMode {
  return value === 'ledger-only' ? 'ledger-only' : 'ledger-and-facts';
}

/**
 * The answer-turn ask `seed` put on the record (`findingsAnswerAsk`, 9.103.0),
 * narrowed the same way: only the one literal the wire ever writes appends
 * the ask, and an absent key is the default the stage itself falls back to
 * (`deps.findingsAnswerAsk ?? 'none'`) — so an armed run on the default,
 * which never wrote the key, rebuilds the piece it served.
 */
export function answerAskOf(value: unknown): FindingsAnswerAsk {
  return value === 'quote-facts' ? 'quote-facts' : 'none';
}

/**
 * The declared ontology `seed` put on the record (`ontology`, 9.106.0),
 * narrowed the way every run constant is: only a record carrying a `spec`
 * with `nodes` and `sources` records composes a piece, and an absent key —
 * every agent without `.ontology()` — composes nothing, which is what the
 * wire did (`callLLM.ts · buildCallLLMStage`, under `deps.ontology`).
 */
export function ontologyOf(
  value: unknown,
): { spec: OntologyRecord['spec']; tools?: OntologyRecord['tools'] } | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const { spec, tools } = value as { spec?: unknown; tools?: unknown };
  if (spec === null || typeof spec !== 'object') return undefined;
  const { nodes, sources } = spec as { nodes?: unknown; sources?: unknown };
  if (
    nodes === null ||
    typeof nodes !== 'object' ||
    sources === null ||
    typeof sources !== 'object'
  ) {
    return undefined;
  }
  // The tool → skills join (9.108.0), taken as the record holds it — a
  // record without the key (9.106.0, or a map naming only static tools)
  // composes the bytes it always did.
  const join = toolsJoinOf(tools);
  return { spec: spec as OntologyRecord['spec'], ...(join !== undefined && { tools: join }) };
}

/** `tools` narrowed by shape: string → string[]; anything else is no join. */
function toolsJoinOf(value: unknown): OntologyRecord['tools'] | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, readonly string[]> = {};
  for (const [name, ids] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(ids) && ids.every((id) => typeof id === 'string'))
      out[name] = ids as string[];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function wantsMapOf(value: unknown): ReadonlyMap<string, readonly string[]> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const map = new Map<string, readonly string[]>();
  for (const [name, kinds] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(kinds) && kinds.every((k) => typeof k === 'string')) {
      map.set(name, kinds as readonly string[]);
    }
  }
  return map.size > 0 ? map : undefined;
}
