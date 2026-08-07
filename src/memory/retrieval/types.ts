/**
 * retrieval/types — the record a retrieval leaves behind, and the seam
 * that decides which candidates reach the prompt.
 *
 * Pattern: Strategy (the seam) + Value objects (the record).
 * Role:    memory/ layer. The law this folder exists to keep is stated
 *          once, here, because every stage downstream implements a piece
 *          of it: **a retrieval must be able to say what it considered,
 *          not only what it used.**
 * Emits:   N/A (types only). `loadRelevant` emits
 *          `agentfootprint.memory.retrieved` from the record below;
 *          `formatDefault` emits `agentfootprint.memory.attached` per
 *          admitted chunk.
 *
 * Before 8.8.0 a retrieval computed a cosine score for every candidate
 * and then threw all of them away one line later (`results.map(r =>
 * r.entry)`). The prompt carried the passages; nothing carried the
 * reason. "Why did the agent read this passage" had no answer in the
 * recording, and "why did it NOT read that one" had no answer anywhere —
 * a below-threshold candidate was filtered inside the store and never
 * came back. {@link RetrievalEvidence} is what that answer is made of.
 */
import type { MemoryEntry } from '../entry/index.js';

/**
 * Why a candidate did not reach the prompt. Every rejected candidate
 * names one of these — a rejection without a reason is the silence this
 * whole record exists to remove.
 */
export type RetrievalRejectReason =
  /** Scored below the retriever's `threshold`. The quality floor refused it. */
  | 'below-threshold'
  /** Cleared the threshold, but the context-token budget had no room left. */
  | 'over-budget'
  /** Cleared the threshold and the budget, but the picker's `maxEntries` cap was full. */
  | 'over-max-entries'
  /**
   * Cleared the threshold and the count rule, but the retriever's `maxChars`
   * budget was already spent by better-ranked passages (8.19.0).
   *
   * A COUNT bound is not a SIZE bound: `topK: 10` over ordinary headings can
   * be eleven thousand characters, which over-runs the system-prompt slot's
   * 4000-char default with nothing but defaults. `maxChars` is the size
   * bound, and this reason is what makes spending it visible — the tail is
   * dropped, and the record says which chunks and why.
   */
  | 'over-char-budget';

/**
 * One candidate the retrieval considered — admitted or not.
 *
 * `rank` is the candidate's position by SCORE (1-based, descending),
 * which is not necessarily the order it appears in the prompt: the
 * budget picker admits by recency (see {@link RetrievalEvidence.selectionOrder}).
 * Recording both is the point — a reader can see that the best-scoring
 * chunk was admitted third, and know that was the picker's doing.
 */
export interface RetrievedCandidate {
  /** The store entry's id. For an indexed corpus this is the chunk id. */
  readonly id: string;
  /** Similarity as the store reported it. Cosine ([-1, 1]) for every shipped store. */
  readonly score: number;
  /** 1-based position by score, descending, across the whole candidate pool. */
  readonly rank: number;
  /** Did this candidate's text reach the prompt? */
  readonly admitted: boolean;
  /** Present exactly when `admitted` is false. */
  readonly reason?: RetrievalRejectReason;
  /** Source document, when the indexed value carried one in its metadata. */
  readonly docUri?: string;
  /** Page number, when the loader knew one (PDFs). */
  readonly page?: number;
  /** Section heading, when the splitter knew one. */
  readonly heading?: string;
  /**
   * The exact prompt bytes this chunk contributed, set by the formatter
   * for admitted candidates. Joining every admitted candidate's fragment
   * **in {@link promptPosition} order** with `\n\n` reproduces the
   * injected message exactly — which is what lets one retrieval become
   * one `InjectionRecord` PER CHUNK without changing a single byte the
   * model sees.
   */
  readonly promptFragment?: string;
  /**
   * Where this chunk sat in the injected message, 0-based.
   *
   * NOT the same as {@link rank}, and the difference is the honest part:
   * `rank` is how well the chunk scored, `promptPosition` is where the
   * budget picker put it. Under the default recency ordering the
   * best-scoring chunk can land last — which is exactly the kind of thing
   * a lost-in-the-middle investigation needs to be able to see, and which
   * a record that only kept one of the two orders could not show.
   */
  readonly promptPosition?: number;
}

/**
 * Everything one retrieval knows about itself. Written to the memory
 * subflow's scope by `loadRelevant`, refined by `pickByBudget` and
 * `formatDefault`, and lifted to the PARENT scope by the read mount so
 * it lands in the root commit log where a slice can reach it.
 */
export interface RetrievalEvidence {
  /** The retriever's id (`defineRAG({ id })`). Stamped by the read mount. */
  readonly memoryId?: string;
  /**
   * A stable hash of the query text — NOT the text. The query is already
   * in the recording once (as `userMessage`); copying it into a second
   * key would widen the exposure surface for no new information, and any
   * redaction policy the host configured for the first copy would not
   * know about the second.
   */
  readonly queryHash: string;
  /** How many chunks the retriever was willing to admit. */
  readonly k: number;
  /** The quality floor. Absent when the retriever set none. */
  readonly threshold?: number;
  /**
   * The character budget the admitted passages were spent against (8.19.0).
   * Absent when the retriever set none — which is the default, and means
   * `k` was the only bound on how much text reached the prompt.
   */
  readonly maxChars?: number;
  /**
   * How many characters of PASSAGE the admitted set spends. Present exactly
   * when {@link maxChars} is, and re-stated by the budget picker so it can
   * never disagree with {@link admittedCount}.
   *
   * Passage characters, not prompt bytes: the `<source …>` wrapper and the
   * block header are added later by the formatter and are not counted here.
   * The exact bytes are on each candidate's `promptFragment` once the
   * formatter has run.
   */
  readonly charsUsed?: number;
  /** The embedder id the query was produced with, when the caller declared one. */
  readonly embedderId?: string;
  /** Length of the query vector. Mixing two lengths in one store is a config bug. */
  readonly dimensions?: number;
  /** How the budget picker ordered the admitted set. See the note on `rank`. */
  readonly selectionOrder: 'recency' | 'relevance';
  /** How many candidates came back from the store. */
  readonly consideredCount: number;
  /** How many reached the prompt. */
  readonly admittedCount: number;
  /** `consideredCount - admittedCount`. */
  readonly rejectedCount: number;
  /**
   * The candidates themselves, best-scoring first.
   *
   * `undefined` means this store could not tell us — see
   * {@link candidatesOmittedReason}. It never means "there were none";
   * that case is `[]` with `consideredCount: 0`.
   */
  readonly candidates?: readonly RetrievedCandidate[];
  /**
   * Whether {@link candidates} is the complete set of candidates that
   * existed, or only as far as the pool we asked for reached.
   *
   * `false` does NOT weaken the admitted set — see the proof in
   * `loadRelevant`. It only means the REJECTED list is a sample: there
   * may be further below-threshold entries we never saw.
   */
  readonly candidatesComplete: boolean;
  /** Present exactly when `candidates` is undefined. */
  readonly candidatesOmittedReason?: string;
  /**
   * The store returned nothing at all for this namespace. Distinct from
   * "everything scored below threshold" (`consideredCount > 0`), and the
   * distinction is the whole diagnosis: an empty namespace almost always
   * means the corpus was indexed somewhere else.
   */
  readonly corpusEmpty: boolean;
  /** The namespace that was searched, as a plain string, for the diagnosis above. */
  readonly namespace?: string;
}

/**
 * The retrieval seam: given the candidates a store returned, decide
 * which of them the prompt may have — and say why about each one.
 *
 * A strategy NEVER talks to the store and never embeds anything. It is
 * handed a scored, score-descending pool and returns a verdict per
 * candidate. That narrowness is what makes it composable: a re-ranker or
 * a diversity selector is the same shape with a different body.
 *
 * Shipped: {@link topK}. Deliberately NOT shipped in 8.8.0, and named
 * here so the destination is on record rather than implied — a
 * cross-encoder `rerank(...)` and a maximal-marginal-relevance `mmr(...)`
 * are additional adapters behind this same interface. Neither needs an
 * engine change, a new stage, or a new event; both were left out because
 * a re-ranker without a shipped re-ranking model is a config with nothing
 * to configure.
 */
export interface RetrievalStrategy {
  /** Stable name — appears in the recording and in refusal messages. */
  readonly name: string;
  /** How many candidates this strategy is willing to admit. */
  readonly k: number;
  /** The quality floor, when the strategy has one. */
  readonly threshold?: number;
  /**
   * How many EXTRA candidates to pull past `k` purely so that rejected
   * ones can be shown. Never affects which candidates are admitted.
   */
  readonly rejectWindow: number;
  /**
   * Rule on a score-descending pool. Return one verdict per input, in
   * the same order. Implementations must not reorder.
   */
  select(pool: readonly ScoredCandidate[]): readonly RetrievalVerdict[];
}

/** One store result, as a strategy sees it. */
export interface ScoredCandidate {
  readonly entry: MemoryEntry<unknown>;
  readonly score: number;
}

/** A strategy's ruling on one candidate. */
export interface RetrievalVerdict {
  readonly admitted: boolean;
  readonly reason?: RetrievalRejectReason;
}
