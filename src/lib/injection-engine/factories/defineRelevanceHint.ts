/**
 * defineRelevanceHint — an advisory system-prompt note for an ambiguous entry.
 *
 * When `entryByRelevance()` picks the starting skill but the top candidates are a
 * NEAR-TIE under the relevance scorer, this injection drops a NON-BINDING note into
 * the system prompt for that turn: "an offline scorer found these close; it can't
 * see the conversation — use your own judgment." A hint, not an order.
 *
 * Anti-anchoring is the point (the proxy is a rough keyword match, not the model's
 * own reasoning), so the note is framed as advisory and only fires on a real tie.
 * It rides the normal injection path (`context.evaluated`) — no new event. Reads
 * `ctx.entryScores` (set by the PickEntry stage), so it needs `.entryByRelevance()`.
 *
 * Add it explicitly: `Agent.create(...).skillGraph(graph).injection(defineRelevanceHint())`.
 */

import type { Injection, InjectionContext } from '../types.js';

export interface RelevanceHintOptions {
  /** Injection id (default `'relevance-hint'`). */
  readonly id?: string;
  /**
   * Near-tie threshold: the hint fires when (top relevance − 2nd relevance) is
   * below this. Default `0.15` (relevances are softmax shares summing to 1).
   */
  readonly threshold?: number;
}

/**
 * The metadata marker that says "this injection reads `ctx.entryScores`" (8.7.0).
 *
 * Only `.entryBy()` / `.entryByRelevance()` ever write `entryScores` — the PickEntry
 * stage runs a scorer and stamps them. Mounted on a graph with no scorer, the hint's
 * trigger simply can never be true, and nothing said so: the injection registered,
 * evaluated false on every iteration for the life of the agent, and the author saw a
 * feature that was configured and inert.
 *
 * A marker rather than an id match, because the id is the caller's to choose
 * (`defineRelevanceHint({ id })`) — matching on `'relevance-hint'` would miss every
 * renamed one and would false-positive on anybody else's injection of that name.
 * `AgentBuilder.build()` reads it and dev-warns.
 */
export const READS_ENTRY_SCORES_METADATA_KEY = 'readsEntryScores' as const;

/** Is the top entry a near-tie with the runner-up? */
function isNearTie(scores: InjectionContext['entryScores'], threshold: number): boolean {
  if (!scores || scores.length < 2) return false;
  const sorted = [...scores].sort((a, b) => b.relevance - a.relevance);
  return sorted[0]!.relevance - sorted[1]!.relevance < threshold;
}

export function defineRelevanceHint(options: RelevanceHintOptions = {}): Injection {
  const threshold = options.threshold ?? 0.15;
  return {
    id: options.id ?? 'relevance-hint',
    flavor: 'instructions',
    description: 'Advisory note when the entry skill was a near-tie under the relevance scorer',
    trigger: {
      kind: 'rule',
      activeWhen: (ctx) => ctx.iteration === 1 && isNearTie(ctx.entryScores, threshold),
    },
    metadata: { [READS_ENTRY_SCORES_METADATA_KEY]: true },
    inject: {
      systemPrompt:
        'Note: an offline relevance scorer found two or more starting skills nearly tied for ' +
        'this request. That scorer only matches description keywords and cannot see the ' +
        'conversation, so treat the auto-selected skill as a weak hint — not an instruction. ' +
        'Use your own judgment about which skill actually fits; if a different one is clearly ' +
        'better, switch to it.',
    },
  };
}
