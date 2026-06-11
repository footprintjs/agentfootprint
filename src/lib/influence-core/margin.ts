/**
 * scoreMargin — choice-margin scoring over a candidate set
 * (RFC-002 C4's core: (candidates, contextText, chosen) → scores +
 * margin + flags).
 *
 * Pattern: pure async function, embedder-injected. NO recorder wiring
 *          — `toolChoiceRecorder` (C5) owns event ingestion and a
 *          KeyedStore, and calls this for the math.
 * Role:    `src/lib/influence-core/` leaf. No agent/runtime imports.
 *
 * The competition model (RFC-002 §4): embed the choice context (what
 * the model saw — user message + latest reasoning), embed each offered
 * candidate's text, rank candidates by similarity to the context.
 *   margin = score(best chosen) − score(best non-chosen)
 * Small margin = fragile choice (`narrow`); top-scored candidate not
 * among the chosen = `proxyDisagreement` (always worth surfacing:
 * either a proxy miss or a genuinely surprising model choice).
 *
 * Honest claim: the scores are embedding geometry between context and
 * descriptions — a proxy for the model's selection function, never
 * "the model chose because". Margin is EVIDENCE of decisiveness, not
 * proof; tier 3 (choice-entropy sampling) validates the proxy.
 */
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type { CandidateScore, Embedder, MarginCandidate, MarginResult } from './types.js';
import { DEFAULT_MARGIN_THRESHOLD } from './types.js';

export interface ScoreMarginArgs {
  /** The offered candidates (e.g. the tool catalog on `llm_start`). */
  readonly candidates: readonly MarginCandidate[];
  /** The choice context — the text the chooser ranked against. */
  readonly contextText: string;
  /** Names of the chosen candidate(s). Must exist in `candidates`. */
  readonly chosen: readonly string[];
  /**
   * Injected embedder. Wrap in an `EmbeddingCache` so descriptions
   * embed once across calls (RFC-002 §3 — the same cache the catalog
   * lint already filled).
   */
  readonly embedder: Embedder;
  /** Margins below this flag `narrow`. Default 0.05 (RFC-002 §4). */
  readonly marginThreshold?: number;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/**
 * Rank candidates by cosine similarity to the choice context and
 * measure how decisively the chosen one(s) won.
 *
 * Returns ranked `scores` (descending; ties keep candidate input
 * order), the `topScored` name, the `margin` (undefined when every
 * candidate was chosen — no competition to measure; `narrow` is false
 * in that case), and the two flags.
 *
 * Fail-loud validation: empty candidates/chosen, duplicate candidate
 * names, or a chosen name missing from the candidates throw — those
 * are wiring bugs in the caller, not runtime conditions.
 */
export async function scoreMargin(args: ScoreMarginArgs): Promise<MarginResult> {
  const { candidates, chosen, embedder } = args;
  const marginThreshold = args.marginThreshold ?? DEFAULT_MARGIN_THRESHOLD;
  validate(candidates, chosen);

  // One deduplicated embedding pass: context + distinct candidate texts.
  const distinct = [...new Set([args.contextText, ...candidates.map((c) => c.text)])];
  const vectors = embedder.embedBatch
    ? await embedder.embedBatch({
        texts: distinct,
        ...(args.signal ? { signal: args.signal } : {}),
      })
    : await sequentialEmbed(embedder, distinct, args.signal);
  const vectorByText = new Map<string, readonly number[]>();
  for (let i = 0; i < distinct.length; i++) vectorByText.set(distinct[i], vectors[i]);

  const contextVec = vectorByText.get(args.contextText) as readonly number[];
  const scores: CandidateScore[] = candidates.map((candidate) => ({
    name: candidate.name,
    score: cosineSimilarity(contextVec, vectorByText.get(candidate.text) as readonly number[]),
  }));
  // Stable sort — ties keep candidate input order.
  scores.sort((a, b) => b.score - a.score);

  const chosenSet = new Set(chosen);
  let bestChosen = -Infinity;
  let bestOther = -Infinity;
  for (const { name, score } of scores) {
    if (chosenSet.has(name)) bestChosen = Math.max(bestChosen, score);
    else bestOther = Math.max(bestOther, score);
  }

  const margin = bestOther === -Infinity ? undefined : bestChosen - bestOther;
  const topScored = scores[0].name;

  return {
    scores,
    chosen: [...chosen],
    topScored,
    margin,
    flags: {
      narrow: margin !== undefined && margin < marginThreshold,
      proxyDisagreement: !chosenSet.has(topScored),
    },
  };
}

async function sequentialEmbed(
  embedder: Embedder,
  texts: readonly string[],
  signal?: AbortSignal,
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedder.embed({ text, ...(signal ? { signal } : {}) }));
  }
  return out;
}

function validate(candidates: readonly MarginCandidate[], chosen: readonly string[]): void {
  if (candidates.length === 0) {
    throw new Error('scoreMargin: candidates must be non-empty');
  }
  const names = new Set<string>();
  for (const candidate of candidates) {
    if (names.has(candidate.name)) {
      throw new Error(
        `scoreMargin: duplicate candidate name '${candidate.name}' — names must be unique`,
      );
    }
    names.add(candidate.name);
  }
  if (chosen.length === 0) {
    throw new Error(
      'scoreMargin: chosen must be non-empty — calls that chose nothing have no margin to score',
    );
  }
  for (const name of chosen) {
    if (!names.has(name)) {
      throw new Error(`scoreMargin: chosen '${name}' is not among the candidates`);
    }
  }
}
