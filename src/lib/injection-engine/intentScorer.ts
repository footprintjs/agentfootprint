/**
 * IntentScorer — the pluggable PORT that judges a new user message against the
 * graph's declared intents (SG-C tier 2).
 *
 * Custody split, deliberately: a scorer produces NUMBERS for EVERY candidate —
 * never a bare winner — and the FRAMEWORK (`routingPolicy.decideTier2`)
 * applies the floor and the near-tie margin, decides the verdict, and records
 * it. That is what keeps scorers a tier and never a correctness dependency: a
 * scorer cannot route by itself, and its near-ties fall through to the model.
 *
 * Three built-ins share this port:
 *   • `keywordScorer()`        — widened in `entryScorer.ts` (no dependency;
 *     set-cosine over intent + example tokens; `floor: 0` — zero overlap IS
 *     honestly "did not match at all");
 *   • `embeddingScorer(e)`     — widened in `entryScorer.ts` (semantic cosine;
 *     NO floor unless the consumer declares one — an absolute embedding
 *     threshold is a lie by default);
 *   • `llmClassifier(provider)` — `llmClassifier.ts` (one constrained-enum
 *     model call per turn, off the hot loop; `categorical`).
 *
 * `when` predicates remain the opaque escape hatch — tier 1, never scored.
 */

/** One candidate the classifier judges — a declared intent, or the incumbent
 *  skill (its `intent` = its description; examples may be empty). Ids are
 *  never fabricated — every candidate comes from the graph. */
export interface IntentCandidate {
  readonly id: string;
  /** One sentence naming the intent ("customer wants a refund"). */
  readonly intent: string;
  /** Real user phrasings. May be empty only for the incumbent. */
  readonly examples: readonly string[];
}

/** What a scorer receives. `recentTurns` is present ONLY when the scorer
 *  declared a `window` — newest last, the current message excluded. */
export interface IntentScorerInput {
  /** The NEW user message that started this turn. */
  readonly message: string;
  readonly recentTurns?: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}

/** One candidate's raw, strategy-specific score — same contract as
 *  `EntryScore.score`: higher = more relevant, not normalized across
 *  strategies. The framework softmaxes for the recorded relevance shares. */
export interface IntentScore {
  readonly id: string;
  readonly score: number;
}

/**
 * The port. Score EVERY candidate — the framework refuses a result that omits
 * a candidate or names an id it wasn't given (see {@link validateIntentScores}).
 * Runs ONCE per turn, off the hot loop, in the RouteTurn stage.
 */
export interface IntentScorer {
  /** Short stable name — lands on the record (`turn_routed.scorer`). */
  readonly name: string;
  /** Declared floor: a raw score at/below it means "did not match at all".
   *  Absent = this scorer cannot honestly claim non-match (embeddings). */
  readonly floor?: number;
  /** Declared recent-turns window (count of prior conversational turns the
   *  scorer wants to see). Absent = current message only. */
  readonly window?: number;
  /** One id or none (the LLM classifier): a pick is decisive by construction
   *  and is never diluted by the near-tie margin. */
  readonly categorical?: boolean;
  score(
    input: IntentScorerInput,
    candidates: readonly IntentCandidate[],
    signal?: AbortSignal,
  ): Promise<readonly IntentScore[]> | readonly IntentScore[];
}

/**
 * The framework's half of the scorer contract: every candidate scored exactly
 * once, no foreign ids. Returns the scores in CANDIDATE order (so a scorer
 * that reordered them cannot smuggle a different ranking past the caller's
 * declaration order). Throws a teaching error naming the scorer, what it
 * omitted or invented, and the contract — the RouteTurn stage treats that
 * throw exactly like a scorer failure (fall through to the recorded fallback),
 * because a misbehaving scorer must never abort a run.
 */
export function validateIntentScores(
  scorerName: string,
  candidates: readonly IntentCandidate[],
  result: readonly IntentScore[],
): readonly IntentScore[] {
  const byId = new Map<string, IntentScore>();
  const foreign: string[] = [];
  for (const s of result) {
    if (candidates.some((c) => c.id === s.id)) byId.set(s.id, s);
    else foreign.push(s.id);
  }
  const missing = candidates.filter((c) => !byId.has(c.id)).map((c) => c.id);
  if (foreign.length > 0 || missing.length > 0) {
    const clauses = [
      ...(missing.length > 0 ? [`omitted ${missing.map((m) => `"${m}"`).join(', ')}`] : []),
      ...(foreign.length > 0
        ? [`named ${foreign.map((f) => `"${f}"`).join(', ')} which it was not given`]
        : []),
    ];
    throw new Error(
      `IntentScorer '${scorerName}' returned an unusable result: it ${clauses.join(' and ')}. ` +
        `A scorer must return one score per candidate it was given — every candidate, no ` +
        `foreign ids — and the framework decides the verdict from the numbers. Fix the ` +
        `scorer's score() to map over its \`candidates\` argument.`,
    );
  }
  return candidates.map((c) => byId.get(c.id)!);
}
