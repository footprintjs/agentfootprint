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
 */
import type { TypedScope } from 'footprintjs';
import type { LLMMessage as Message } from '../../adapters/types.js';
import type { MemoryStore, ScoredEntry } from '../store/index.js';
import type { MemoryState } from '../stages/index.js';
import { identityNamespace } from '../identity/index.js';
import { fnv1a } from '../../lib/fnv1a.js';
import { chunkProvenance } from '../retrieval/provenance.js';
import { topK } from '../retrieval/topK.js';
import type {
  RetrievalEvidence,
  RetrievalStrategy,
  RetrievalVerdict,
  RetrievedCandidate,
} from '../retrieval/types.js';
import type { Embedder } from './types.js';

export interface LoadRelevantConfig {
  /** The vector-capable store. Must implement `search()`. */
  readonly store: MemoryStore;

  /** Embedder used to turn the query text into a vector. */
  readonly embedder: Embedder;

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

/** Emit through the scope's emit channel when there is one (there always is under an Agent). */
function emit(scope: TypedScope<MemoryState>, type: string, payload: unknown): void {
  const emitter = (scope as unknown as { $emit?: (t: string, p: unknown) => void }).$emit;
  if (typeof emitter === 'function') emitter.call(scope, type, payload);
}

export function loadRelevant(config: LoadRelevantConfig) {
  const { store, embedder } = config;
  if (!store.search) {
    throw new Error(
      'loadRelevant: the configured store does not implement search(). ' +
        'Use a vector-capable adapter (InMemoryStore, pgvector, Pinecone, ...).',
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
      queryHash: fnv1a(text),
      k: strategy.k,
      ...(strategy.threshold !== undefined && { threshold: strategy.threshold }),
      ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
      selectionOrder: 'recency' as const,
      namespace,
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
    const queryVec = (await embedder.embed({
      text,
      ...(signal ? { signal } : {}),
    })) as number[];

    // store.search optional on MemoryStore but required when an embedder
    // is configured (validated upstream by defineMemory).
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const results = (await store.search!(identity, queryVec, {
      k: poolSize,
      // `minScore` is deliberately NOT forwarded — see the header proof.
      ...(config.tiers && { tiers: config.tiers }),
      ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
      text,
    })) as readonly ScoredEntry<unknown>[];

    // A store that ranks server-side may return entries without a usable
    // score. We report that rather than printing a number we did not get.
    const scoresUsable = results.every(
      (r) => typeof r.score === 'number' && Number.isFinite(r.score),
    );

    const verdicts: readonly RetrievalVerdict[] = scoresUsable
      ? strategy.select(results.map((r) => ({ entry: r.entry, score: r.score })))
      : // No comparable scores to rule on. The store already ranked, so we
        // honour its order and take the first `k` — and say in the record
        // that we could not see the candidates ourselves.
        results.map((_, i): RetrievalVerdict => ({ admitted: i < strategy.k }));

    const admitted: ScoredEntry<unknown>[] = [];
    const candidates: RetrievedCandidate[] = [];
    results.forEach((result, i) => {
      // `verdicts` is built from `results` above, one per element.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const verdict = verdicts[i]!;
      if (verdict.admitted) admitted.push(result);
      candidates.push({
        id: result.entry.id,
        score: result.score,
        rank: i + 1,
        admitted: verdict.admitted,
        ...(verdict.reason !== undefined && { reason: verdict.reason }),
        ...chunkProvenance(result.entry.value),
      });
    });

    const evidence: RetrievalEvidence = {
      ...baseEvidence,
      ...(queryVec.length > 0 && { dimensions: queryVec.length }),
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

    scope.loaded = admitted.map((r) => r.entry) as MemoryState['loaded'];
    scope.retrieved = evidence;

    // Telemetry rides the emit channel, never a commit payload. The
    // memory bridge (`memoryRecorder`) is attached on every Agent run, so
    // this reaches `agent.on('agentfootprint.memory.retrieved')` with no
    // extra wiring. Which retriever fired is `meta.runtimeStageId`
    // (`sf-memory-read-<id>/load-relevant#N`) — the house correlation model.
    emit(scope, 'agentfootprint.memory.retrieved', {
      queryHash: evidence.queryHash,
      k: evidence.k,
      ...(evidence.threshold !== undefined && { threshold: evidence.threshold }),
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

    // An empty namespace is almost never "the corpus has nothing to say".
    // It is almost always "the corpus was indexed under a different
    // identity than the one being queried" — the failure that used to be
    // completely silent. Say it once per process, naming both sides.
    if (evidence.corpusEmpty) warnEmptyCorpus(namespace);
  };
}

const warnedNamespaces = new Set<string>();

function warnEmptyCorpus(namespace: string): void {
  if (warnedNamespaces.has(namespace)) return;
  warnedNamespaces.add(namespace);
  console.warn(
    `[agentfootprint] Semantic retrieval found NO entries at all in namespace '${namespace}'.\n` +
      `  Nothing was injected, and the answer will come from the model alone.\n` +
      `  The usual cause is that the corpus was indexed under a different identity than the one\n` +
      `  being queried: indexDocuments() defaults to { conversationId: '_global' }, and a memory\n` +
      `  reads under the identity passed to agent.run() unless the retriever declares its own\n` +
      `  \`corpus\`. defineRAG() defaults \`corpus\` to { conversationId: '_global' } so the two\n` +
      `  sides meet; pass \`corpus\` explicitly when you index per tenant.`,
  );
}

/** Test seam — the once-per-process warning is per PROCESS, which tests must be able to reset. */
export function __resetEmptyCorpusWarnings(): void {
  warnedNamespaces.clear();
}
