/**
 * EntryScorer — the pluggable STRATEGY for ranking a skill graph's entry
 * candidates by relevance to the user's message.
 *
 * `skillGraph().entryBy(scorer)` selects a strategy; the agent's PickEntry stage
 * runs it ONCE per turn (off the hot loop) and starts the cursor at the winner.
 * Two built-ins ship:
 *   • `keywordScorer()`      — no dependency, no model call: word overlap between
 *     the message and each skill's `description`. The zero-config way to route.
 *   • `embeddingScorer(e)`   — semantic: cosine similarity of embeddings (needs an
 *     Embedder). `.entryByRelevance(embedder)` is sugar for this.
 * Bring your own by implementing `EntryScorer`.
 *
 * The scorer OWNS both the surfaced `relevance` % AND the `chosen` winner, so the
 * explanation and the decision can never disagree (softmax is order-preserving, so
 * argmax-score == argmax-relevance).
 */

import type { Embedder } from '../../memory/embedding/types.js';
import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import { softmax } from './softmax.js';
import type {
  IntentCandidate,
  IntentScore,
  IntentScorer,
  IntentScorerInput,
} from './intentScorer.js';

/** One entry candidate's relevance to the user's message. */
export interface EntryScore {
  /** The entry skill id. */
  readonly id: string;
  /** Raw, strategy-specific score — cosine for `embedding`, word-overlap for
   *  `keyword`. Higher = more relevant. Not normalized across strategies. */
  readonly score: number;
  /** Softmax share across candidates, 0..1 — the surfaced "Why this skill?" %. */
  readonly relevance: number;
}

/** Result of scoring the entries — the picked entry, the full ranking, and which
 *  scorer produced it. */
export interface EntryScoring {
  /** The scorer's `name` (e.g. `'keyword'`, `'embedding'`) — surfaced so a lens /
   *  the "Why this skill?" panel can say HOW the entry was chosen. */
  readonly scorer: string;
  /** Winning entry id (highest `score`), or undefined if no candidate. */
  readonly chosen: string | undefined;
  /** Every scored candidate, in declaration order. */
  readonly ranked: readonly EntryScore[];
}

/** A candidate the scorer ranks — its id + the text it's matched on (the skill's
 *  `description`). */
export interface EntryCandidate {
  readonly id: string;
  readonly description: string;
}

/** What a scorer receives: the user's message + the candidates to rank. */
export interface EntryScorerInput {
  readonly userMessage: string;
  readonly candidates: readonly EntryCandidate[];
}

/**
 * A strategy for ranking entry candidates. Pure given its inputs; may be async (an
 * embedder makes network calls). Runs ONCE per turn off the hot loop, so cost here
 * never touches the ReAct inner loop.
 */
export interface EntryScorer {
  /** Short, stable name — shown in the lens / "Why this skill?" panel + any
   *  strategy picker. */
  readonly name: string;
  score(input: EntryScorerInput, signal?: AbortSignal): Promise<EntryScoring> | EntryScoring;
}

/**
 * Shared finisher: raw scores → `EntryScoring`. Softmax turns the (sanitized) raw
 * scores into a `relevance` share (sums to 1); the winner is the argmax with
 * declaration order breaking ties. Because softmax is order-preserving over the
 * sanitized scores, the WINNER is always the argmax `relevance` — the surfaced %
 * and the pick can never disagree.
 *
 * `EntryScorer` is a public, consumer-implementable interface, so a third-party
 * scorer might return `NaN` / `±Infinity`. We sanitize those to `-Infinity` for BOTH
 * the softmax input AND the winner pick, so a non-finite score can never silently win
 * (`NaN > x` is always false — a leading `NaN` would otherwise seed-and-keep a naive
 * reduce) and the softmax stays well-defined. The raw (possibly non-finite) score is
 * still surfaced on `EntryScore.score` for honest debugging.
 */
export function rankEntries(
  scorerName: string,
  candidates: readonly EntryCandidate[],
  rawScores: readonly number[],
): EntryScoring {
  if (candidates.length === 0) return { scorer: scorerName, chosen: undefined, ranked: [] };
  const safe = rawScores.map((s) => (Number.isFinite(s) ? s : Number.NEGATIVE_INFINITY));
  const relevances = softmax(safe);
  const ranked: EntryScore[] = candidates.map((c, i) => ({
    id: c.id,
    score: rawScores[i]!, // the scorer's RAW output (may be non-finite — honest)
    relevance: relevances[i]!,
  }));
  // argmax over the SANITIZED scores (declaration order breaks ties) — never over the
  // raw scores, so a NaN/Inf can't win. Order-preserving with `relevance`.
  let winner = 0;
  for (let i = 1; i < safe.length; i++) if (safe[i]! > safe[winner]!) winner = i;
  return { scorer: scorerName, chosen: ranked[winner]!.id, ranked };
}

/**
 * keywordScorer — rank by word overlap between the message and each description.
 * No embedder, no model call, deterministic. Scores the set-cosine of lowercased
 * word tokens (length-normalized so a long description can't win on sheer size),
 * minus a small stop-word list. The zero-config router: good enough when skill
 * descriptions use the words a user would.
 *
 * ALSO an {@link IntentScorer} (SG-C): handed a candidates array as the second
 * argument it scores the message's set-cosine against each intent's sentence +
 * examples, and declares `floor: 0` — zero token overlap IS honestly "did not
 * match at all", so this scorer can say *unmatched*. One factory, one name,
 * two arities; existing `EntryScorer` callers are byte-unaffected.
 */
export function keywordScorer(
  options: { readonly stopWords?: readonly string[] } = {},
): EntryScorer & IntentScorer {
  const stop = new Set((options.stopWords ?? DEFAULT_STOP_WORDS).map((w) => w.toLowerCase()));
  function score(input: EntryScorerInput, signal?: AbortSignal): EntryScoring;
  function score(
    input: IntentScorerInput,
    candidates: readonly IntentCandidate[],
    signal?: AbortSignal,
  ): readonly IntentScore[];
  function score(
    input: EntryScorerInput | IntentScorerInput,
    second?: AbortSignal | readonly IntentCandidate[],
  ): EntryScoring | readonly IntentScore[] {
    if (Array.isArray(second)) {
      // Intent path — set-cosine of the message against intent + example tokens.
      const q = tokenize((input as IntentScorerInput).message, stop);
      return second.map((c) => ({
        id: c.id,
        score: setCosine(q, tokenize([c.intent, ...c.examples].join(' '), stop)),
      }));
    }
    const { userMessage, candidates } = input as EntryScorerInput;
    const q = tokenize(userMessage, stop);
    const scores = candidates.map((c) => setCosine(q, tokenize(c.description, stop)));
    return rankEntries('keyword', candidates, scores);
  }
  return { name: 'keyword', floor: 0, score };
}

/**
 * embeddingScorer — rank by SEMANTIC similarity. Embeds the message + each
 * description and cosine-scores them. Needs an `Embedder` (a model call per text);
 * runs once per turn off the hot loop. `.entryByRelevance(embedder)` is sugar for
 * `.entryBy(embeddingScorer(embedder))`.
 *
 * ALSO an {@link IntentScorer} (SG-C): handed a candidates array it embeds the
 * message + one text per candidate (the intent sentence with its examples) and
 * cosine-scores them. **No floor unless you declare one** (`{ floor }`): an
 * absolute embedding threshold is a lie by default — measured in the field,
 * real intent clusters separate by single-digit percentages of cosine, so a
 * built-in cutoff would flip between "unmatched" and "decisive" on noise.
 * Without a floor this scorer can say *stay*, *move* or *near-tie*, never
 * *unmatched* — the verdict table documents that honestly.
 */
export function embeddingScorer(
  embedder: Embedder,
  options: { readonly floor?: number } = {},
): EntryScorer & IntentScorer {
  async function embedAll(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    // One embedBatch round-trip when the backend supports it (OpenAI/Voyage/…),
    // else N+1 CONCURRENT embed() calls — never the serial N+1 latency stack.
    const sig = signal ? { signal } : {};
    return embedder.embedBatch
      ? [...(await embedder.embedBatch({ texts: [...texts], ...sig }))]
      : Promise.all(texts.map((text) => embedder.embed({ text, ...sig })));
  }
  function score(input: EntryScorerInput, signal?: AbortSignal): Promise<EntryScoring>;
  function score(
    input: IntentScorerInput,
    candidates: readonly IntentCandidate[],
    signal?: AbortSignal,
  ): Promise<readonly IntentScore[]>;
  async function score(
    input: EntryScorerInput | IntentScorerInput,
    second?: AbortSignal | readonly IntentCandidate[],
    third?: AbortSignal,
  ): Promise<EntryScoring | readonly IntentScore[]> {
    if (Array.isArray(second)) {
      if (second.length === 0) return [];
      const texts = [
        (input as IntentScorerInput).message,
        ...second.map((c) => [c.intent, ...c.examples].join('\n')),
      ];
      const [qVec, ...cVecs] = await embedAll(texts, third);
      return second.map((c, i) => ({ id: c.id, score: cosineSimilarity(qVec!, cVecs[i]!) }));
    }
    const { userMessage, candidates } = input as EntryScorerInput;
    if (candidates.length === 0) return { scorer: 'embedding', chosen: undefined, ranked: [] };
    const texts = [userMessage, ...candidates.map((c) => c.description)];
    const [qVec, ...dVecs] = await embedAll(texts, second as AbortSignal | undefined);
    const scores = dVecs.map((dVec) => cosineSimilarity(qVec!, dVec));
    return rankEntries('embedding', candidates, scores);
  }
  return {
    name: 'embedding',
    ...(options.floor !== undefined && { floor: options.floor }),
    score,
  };
}

/** Small, conservative stop list — fillers a user would never route on. */
const DEFAULT_STOP_WORDS = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'to',
  'of',
  'for',
  'in',
  'on',
  'at',
  'by',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'we',
  'my',
  'our',
  'me',
  'please',
  'can',
  'could',
  'would',
  'should',
  'do',
  'does',
  'how',
  'what',
  'need',
  'want',
];

/**
 * Lowercase → split on non-alphanumerics → drop 1-char tokens + stop words →
 * light plural fold → set. The plural fold (drop a single trailing `s` on tokens
 * length ≥ 4) lets `refund` match `refunds` and `payment` match `payments` — the
 * common miss that makes a naive keyword router feel broken. Conservative: short
 * words (`is`, `as`, `bus`) are untouched.
 */
function tokenize(text: string, stop: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || stop.has(raw)) continue;
    // Fold a single trailing 's' (refunds→refund) but NOT '-ss' (address stays
    // address) — that asymmetry would defeat the matching it's for. ASCII only:
    // non-Latin/accented text is split away by the regex, so the keyword router is
    // effectively English/ASCII (use embeddingScorer for other languages).
    const fold = raw.length >= 4 && raw.endsWith('s') && !raw.endsWith('ss');
    out.add(fold ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** |A ∩ B| / sqrt(|A| · |B|) — set cosine, 0..1. Empty either side → 0. */
function setCosine(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared += 1;
  return shared / Math.sqrt(a.size * b.size);
}
