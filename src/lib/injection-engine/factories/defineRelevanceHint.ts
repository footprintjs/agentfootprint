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
