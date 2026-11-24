/**
 * loadRelevant — read-side stage that embeds a query and fetches the
 * most similar entries from a vector-capable `MemoryStore`.
 *
 * Reads from scope:   `identity`, `messages` (or `newMessages`, or custom queryFrom)
 * Writes to scope:    `loaded` (MemoryEntry[], ordered best-first — narrowed
 *                     by `pickByBudget` downstream)
 *                     `retrieved` (RetrievalEvidence — what was considered,
 *                     what was admitted, and why about each one)
 *
 * Query derivation:
 *   Default: the last user message. That's the natural "what is the user
 *   asking about?" signal. Override with `queryFrom` for custom retrieval.
 *
 * Empty behavior:
 *   No query text → no search → `loaded = []`. Downstream `pickByBudget`
 *   picks nothing and the formatter emits nothing — safe, and now
 *   RECORDED: the evidence still lands, saying the query was empty.
 *
 * Feature detection:
 *   Throws at stage build time if the store doesn't implement `search()`.
 *   Fail-loud — a semantic pipeline configured against a non-vector store
 *   is a config bug, not a runtime condition.
 *
 * ─── Why the threshold moved out of the store (8.8.0) ──────────────────
 *
 * Until 8.8.0 the quality floor was passed to `store.search({ minScore })`,
 * so every candidate that failed it was filtered INSIDE the store and never
 * came back. The consequence was not a small one: a retrieval that injected
 * nothing left no trace of what it nearly injected, and "why did the agent
 * not read that passage" had no answer anywhere in the recording.
 *
 * The floor is now applied here, over a pool of `k + rejectWindow`. **This
 * does not change which entries are admitted, ever.** Proof: `search`
 * returns score-descending, and the pool is at least `k`. Either
 *
 *   (a) every entry in the pool clears the floor — then the admitted set is
 *       the first `k` of them, which is exactly what `{ minScore, k }` would
 *       have returned; or
 *   (b) some entry at position p fails the floor — then every entry after p
 *       fails it too, so the pool already contains EVERY entry in the
 *       namespace that clears the floor, and admitting all of them (capped
 *       at `k`) is again exactly what `{ minScore, k }` would have returned.
 *
 * `rejectWindow` therefore only controls how many near-misses we can SHOW.
 * It cannot change what the model sees.
 *
 * ─── The size bound (8.19.0) ───────────────────────────────────────────
 *
 * `k` is a COUNT bound. It says how many passages may reach the prompt and
 * nothing about how much text that is — which is how ten ordinary headings
 * became eleven thousand characters against a 4000-character slot budget,
 * with nothing but defaults on either side. `maxChars` is the bound on the
 * other axis: a character budget spent across the admitted passages in rank
 * order, tail dropped, every drop named `'over-char-budget'` in the record.
 * Unset by default, so a retriever that does not ask for it behaves exactly
 * as it did before.
 */
import type { TypedScope } from 'footprintjs';
import type { LLMMessage as Message } from '../../provider-contract/types.js';
import type { MemoryStore, ScoredEntry, SearchResultEntry } from '../store/index.js';
import { readMemorySearch, supportsRecallSearch } from '../store/readOutcome.js';
import type { MemoryState } from '../stages/index.js';
import { identityNamespace } from '../identity/index.js';
import { resolveRankingMode } from '../store/capability.js';
import { fnv1a } from '../../lib/fnv1a.js';
import { chunkProvenance, chunkText } from '../retrieval/provenance.js';
import { topK } from '../retrieval/topK.js';
import {
  omitAmbiguousRetrievalCandidates,
  recallOutcome,
  recallTimeout,
  type MemoryRecallCandidate,
} from '../retrieval/outcome.js';
import type {
  RetrievalEvidence,
  RetrievalRecording,
  RetrievalStrategy,
  RetrievalVerdict,
  RetrievedCandidate,
} from '../retrieval/types.js';
import type { Embedder } from './types.js';
import { emitEmbedding } from './emitEmbedding.js';
import { emitServed, policyInForce, type EmitScope } from '../../redaction/runRedaction.js';

export interface LoadRelevantConfig {
  /** A store supporting legacy or outcome-aware search. */
  readonly store: MemoryStore;
  readonly recording?: RetrievalRecording;

  /**
   * Embedder used to turn the query text into a vector.
   *
   * Optional since 9.3.0, for a store that declares `ranksBy: 'server-text'`:
   * it takes the question as words (`SearchOptions.text`) and ranks it on the
   * backend's side, so no vector is ever produced, nothing is billed for one,
   * and no `agentfootprint.embedding.generated` is emitted — the recording
   * says an embedding happened only when one did.
   */
  readonly embedder?: Embedder;

  /**
   * Identifier for the embedder. When set, the search filters entries
   * to those produced by the same embedder (prevents cross-model
   * similarity pollution).
   */
  readonly embedderId?: string;

  /** Top-k to retrieve. Default 20 — picker will narrow further by budget. */
  readonly k?: number;

  /** Minimum cosine score [-1, 1] to consider a match. Default: none. */
  readonly minScore?: number;

  /**
   * A character budget for the admitted passages, spent in RANK order
   * (8.19.0). Default: none — `k` is the only bound, exactly as before.
   *
   * Counts passage characters, not rendered prompt bytes. See
   * {@link RetrievalEvidence.maxChars}.
   */
  readonly maxChars?: number;

  /** Filter results by tier. */
  readonly tiers?: ReadonlyArray<'hot' | 'warm' | 'cold'>;

  /**
   * The rule that decides which candidates reach the prompt. Defaults to
   * `topK({ k, threshold: minScore })` — i.e. `k` and `minScore` above are
   * the shorthand, and this is the same rule spelled out. Pass a strategy
   * to replace the rule entirely.
   */
  readonly retrieval?: RetrievalStrategy;

  /**
   * Extract the query text from scope. Default: the last user message.
   * Override for custom retrieval signals.
   */
  readonly queryFrom?: (scope: TypedScope<MemoryState>) => string;
}

/**
 * Default query extractor — last user message.
 *
 * Inside the memory-read subflow (mounted by `mountMemoryRead`), the
 * current turn's messages are piped in as `scope.messages` via the
 * mount's inputMapper. Falls back to `newMessages` for custom pipelines
 * that wire differently.
 */
function defaultQueryFrom(scope: TypedScope<MemoryState>): string {
  const scopeAny = scope as unknown as { messages?: readonly Message[] };
  const incoming = scopeAny.messages ?? [];
  const source: readonly Message[] =
    incoming.length > 0 ? incoming : ((scope.newMessages ?? []) as readonly Message[]);

  for (let i = source.length - 1; i >= 0; i--) {
    const m = source[i];
    if (m.role !== 'user') continue;
    if (m.content) return m.content;
  }
  return '';
}

/** Emit through the scope's emit channel when there is one (there always is under an
 *  Agent) — served by the run's redaction like every typed event
 *  (`src/redaction/runRedaction.ts` · `emitServed`). */
function emit(scope: TypedScope<MemoryState>, type: string, payload: unknown): void {
  const emitter = (scope as unknown as { $emit?: (t: string, p: unknown) => void }).$emit;
  if (typeof emitter === 'function') emitServed(scope as unknown as EmitScope, type, payload);
}

function hasScore<T>(result: SearchResultEntry<T>): result is ScoredEntry<T> {
  return typeof result.score === 'number' && Number.isFinite(result.score);
}

export function loadRelevant(config: LoadRelevantConfig) {
  const { store, embedder } = config;
  if (!supportsRecallSearch(store)) {
    throw new Error(
      'loadRelevant: the configured store does not implement search() or searchWithOutcome(). ' +
        'Use a store that can retrieve (InMemoryStore, sqliteVectorStore, pgVectorStore, ' +
        's3VectorsStore, ...).',
    );
  }
  // Fail-loud at STAGE BUILD time, as this stage has always done for a store
  // with no `search()`: a retriever with no embedder over a store that ranks
  // vectors is a config bug, not a runtime condition, and its symptom would be
  // an empty answer.
  if (!embedder && resolveRankingMode(store, 'loadRelevant') !== 'server-text') {
    throw new Error(
      'loadRelevant: no `embedder` was configured, and this store does not declare ' +
        "`ranksBy: 'server-text'`. Something has to turn the query into a vector before a " +
        'vector-ranking store can answer it.',
    );
  }
  const queryFrom = config.queryFrom ?? defaultQueryFrom;
  // The shorthand and the strategy are two spellings of one rule; the
  // strategy wins when both are present, and `defineMemory` refuses the
  // contradiction before it ever gets here.
  const strategy =
    config.retrieval ??
    topK({
      k: config.k ?? 20,
      threshold: config.minScore === undefined ? null : config.minScore,
      // With no explicit strategy there is no explicit reject window
      // either; 10 near-misses is enough to diagnose a threshold without
      // making every retrieval read a large page.
    });
  const poolSize = strategy.k + strategy.rejectWindow;

  return async (scope: TypedScope<MemoryState>): Promise<void> => {
    const identity = scope.identity;
    const namespace = identityNamespace(identity);
    const text = queryFrom(scope).trim();

    const baseEvidence = {
      // Named here, in the base, so the EMPTY-QUERY record carries it too: a
      // retrieval that never ran still ran under a rule, and "which retriever
      // was this?" is exactly the question an empty record raises.
      strategy: strategy.name,
      queryHash: fnv1a(text),
      k: strategy.k,
      ...(strategy.threshold !== undefined && { threshold: strategy.threshold }),
      ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
      selectionOrder: 'recency' as const,
      namespace,
      ...(config.recording !== undefined && { recording: config.recording }),
    };

    if (text.length === 0) {
      scope.loaded = [];
      const emptyQuery: RetrievalEvidence = {
        ...baseEvidence,
        consideredCount: 0,
        admittedCount: 0,
        rejectedCount: 0,
        candidates: [],
        candidatesComplete: true,
        // The corpus was never asked, so it cannot be reported empty.
        corpusEmpty: false,
      };
      scope.retrieved = emptyQuery;
      return;
    }

    const signal = scope.$getEnv?.()?.signal;
    // No embedder means a store that ranks the TEXT server-side: there is no
    // vector to make, so none is made, none is billed, and no embedding event
    // is emitted. `[]` is what the port's `query` argument honestly is here,
    // and `options.text` below is the query such a store actually reads.
    let queryVec: number[] = [];
    if (embedder) {
      const embedStartedAt = Date.now();
      queryVec = (await embedder.embed({
        text,
        ...(signal ? { signal } : {}),
      })) as number[];

      // The QUERY-time half of the two-phase cost model (8.9.0): one embedding
      // per retrieval, scaling with traffic rather than with corpus size. Paired
      // with the `'document'` side in `embedMessages`, this is what makes the
      // cost of a corpus a number you can read rather than one you estimate.
      emitEmbedding(scope, {
        model: config.embedderId ?? embedder.id ?? 'unknown',
        provider: 'custom',
        inputKind: 'query',
        dimension: queryVec.length,
        count: 1,
        durationMs: Date.now() - embedStartedAt,
      });
    }

    const read = await readMemorySearch(
      store,
      identity,
      queryVec,
      {
        k: poolSize,
        // minScore stays in the strategy, so the recorded pool includes near misses.
        ...(config.tiers && { tiers: config.tiers }),
        ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
        text,
      },
      signal,
    );
    if (!read.ok) {
      scope.loaded = [];
      scope.recallOutcomes = [
        ...(scope.recallOutcomes ?? []),
        recallTimeout(scope.turnNumber, namespace),
      ];
      return;
    }
    const results = read.value;
    const scoresUsable = results.every(hasScore);
    const verdicts: readonly RetrievalVerdict[] = scoresUsable
      ? strategy.select(results.map(({ entry, score }) => ({ entry, score })))
      : // The store's order is evidence. A score-based floor is unavailable here.
        results.map(
          (_, i): RetrievalVerdict =>
            i < strategy.k ? { admitted: true } : { admitted: false, reason: 'over-max-entries' },
        );

    // ── The SIZE bound, spent in rank order (8.19.0) ──────────────────
    // `k` bounds how MANY passages reach the prompt and says nothing about
    // how much text that is. Ten ordinary headings is eleven thousand
    // characters, which over-runs the system-prompt slot's 4000-char
    // default with nothing but defaults on either side. `maxChars` is the
    // bound on the other axis.
    //
    // Rank order, and the TAIL goes: the first passage that does not fit
    // ends the spend, and it and everything after it are refused with
    // `over-char-budget`. Not "skip it and try the next smaller one" —
    // that would silently reorder relevance by length, and a reader of the
    // record could not tell a budget drop from a bad score. A budget
    // smaller than the best-scoring passage therefore admits NOTHING, and
    // says so per candidate rather than half-injecting.
    const maxChars = config.maxChars;
    const droppedForChars = new Set<number>();
    let charsUsed = 0;
    if (maxChars !== undefined) {
      let budgetSpent = false;
      verdicts.forEach((verdict, i) => {
        if (!verdict.admitted) return;
        if (budgetSpent) {
          droppedForChars.add(i);
          return;
        }
        // `verdicts` is built from `results`, one per element.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const cost = chunkText(results[i]!.entry.value).length;
        if (charsUsed + cost > maxChars) {
          budgetSpent = true;
          droppedForChars.add(i);
          return;
        }
        charsUsed += cost;
      });
    }

    const admitted: SearchResultEntry[] = [];
    const candidates: RetrievedCandidate[] = [];
    const recallCandidates: MemoryRecallCandidate[] = [];
    results.forEach((result, i) => {
      // verdicts is built from results, one per element.
      const verdict = verdicts[i];
      if (verdict === undefined)
        throw new TypeError('Retrieval strategy omitted a candidate verdict.');
      const overChars = droppedForChars.has(i);
      const isAdmitted = verdict.admitted && !overChars;
      if (isAdmitted) admitted.push(result);
      const reason = overChars ? ('over-char-budget' as const) : verdict.reason;
      const id = result.entry.id;
      const order = i + 1;
      recallCandidates.push({
        id,
        order,
        admitted: isAdmitted,
        ...(hasScore(result) && { score: result.score }),
        ...(reason !== undefined && { reason }),
      });
      if (scoresUsable && hasScore(result)) {
        candidates.push({
          id,
          score: result.score,
          rank: order,
          admitted: isAdmitted,
          ...(reason !== undefined && { reason }),
          ...(config.recording !== 'ids-only' && chunkProvenance(result.entry.value)),
        });
      }
    });
    const outcome = recallOutcome(
      scope.turnNumber,
      namespace,
      recallCandidates,
      results.length < poolSize,
      scoresUsable ? strategy.threshold : undefined,
    );
    scope.recallOutcomes = [...(scope.recallOutcomes ?? []), outcome];

    const initialEvidence: RetrievalEvidence = {
      ...baseEvidence,
      ...(queryVec.length > 0 && { dimensions: queryVec.length }),
      ...(maxChars !== undefined && { maxChars, charsUsed }),
      consideredCount: results.length,
      admittedCount: admitted.length,
      rejectedCount: results.length - admitted.length,
      ...(scoresUsable
        ? { candidates }
        : {
            candidatesOmittedReason:
              'the store ranked this query server-side and returned no comparable scores',
          }),
      // The pool came back full, so there may be further below-threshold
      // entries we never saw. This never weakens the ADMITTED set (see
      // the header proof) — only the rejected list is a sample.
      candidatesComplete: results.length < poolSize,
      corpusEmpty: results.length === 0,
    };

    const evidence =
      outcome.candidateIdsAmbiguous === true
        ? omitAmbiguousRetrievalCandidates(initialEvidence)
        : initialEvidence;
    scope.loaded = admitted.map((r) => r.entry) as MemoryState['loaded'];
    scope.retrieved = evidence;

    // Telemetry rides the emit channel, never a commit payload. The
    // memory bridge (`memoryRecorder`) is attached on every Agent run, so
    // this reaches `agent.on('agentfootprint.memory.retrieved')` with no
    // extra wiring. Which retriever fired is `meta.runtimeStageId`
    // (`sf-memory-read-<id>/load-relevant#N`) — the house correlation model.
    emit(scope, 'agentfootprint.memory.retrieved', {
      strategy: evidence.strategy,
      queryHash: evidence.queryHash,
      k: evidence.k,
      ...(evidence.threshold !== undefined && { threshold: evidence.threshold }),
      ...(evidence.maxChars !== undefined && {
        maxChars: evidence.maxChars,
        charsUsed: evidence.charsUsed,
      }),
      ...(evidence.embedderId !== undefined && { embedderId: evidence.embedderId }),
      ...(evidence.dimensions !== undefined && { dimensions: evidence.dimensions }),
      consideredCount: evidence.consideredCount,
      admittedCount: evidence.admittedCount,
      rejectedCount: evidence.rejectedCount,
      ...(evidence.candidates !== undefined && { candidates: evidence.candidates }),
      ...(evidence.candidatesOmittedReason !== undefined && {
        candidatesOmittedReason: evidence.candidatesOmittedReason,
      }),
      candidatesComplete: evidence.candidatesComplete,
      corpusEmpty: evidence.corpusEmpty,
      namespace: evidence.namespace,
    });

    // This read returned nothing. Only a run with no caller policy names
    // its search namespace in an out-of-band diagnostic.
    if (evidence.corpusEmpty && policyInForce(scope) === undefined) warnEmptyCorpus(namespace);
  };
}

const warnedNamespaces = new Set<string>();

function warnEmptyCorpus(namespace: string): void {
  if (warnedNamespaces.has(namespace)) return;
  warnedNamespaces.add(namespace);
  console.warn(
    `[agentfootprint] Semantic retrieval returned NO entries for this search in namespace '${namespace}'.\n` +
      `  If the corpus was indexed under a different identity, check the identity\n` +
      `  used by this search: indexDocuments() defaults to { conversationId: '_global' }, and a memory\n` +
      `  reads under the identity passed to agent.run() unless the retriever declares its own\n` +
      `  \`corpus\`. defineRAG() defaults \`corpus\` to { conversationId: '_global' } so the two\n` +
      `  sides meet; pass \`corpus\` explicitly when you index per tenant.`,
  );
}

/** Test seam — the once-per-process warning is per PROCESS, which tests must be able to reset. */
export function __resetEmptyCorpusWarnings(): void {
  warnedNamespaces.clear();
}
