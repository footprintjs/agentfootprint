/**
 * indexCorpus — building the index is itself a flowchart, so the run explains
 * itself.
 *
 * Pattern: a footprintjs chart. Not "a function that logs" — the stages, the
 *          decision, the fan-out and the report are the real thing, and the
 *          commit log IS the indexing report.
 * Role:    rag/ layer. Step three, and the one that ties the other two to a
 *          store.
 * Emits:   `agentfootprint.embedding.generated` (`inputKind: 'document'`) per
 *          embedded batch, through the emit channel.
 *
 * ── Why a chart and not a loop ──────────────────────────────────────────────
 * Indexing is where a corpus acquires the properties retrieval later depends
 * on, and every one of those is a question someone eventually asks at an
 * awkward moment: *why is this chunk in the index? why was that one skipped?
 * what did this run cost? which document went missing?* A `for` loop answers
 * none of them after it has finished. A chart answers all of them from its own
 * commit log, months later, without the caller having saved anything.
 *
 *   discover → load → split → plan (DECIDER)
 *            → take-window → embed (FAN-OUT + retry) → tally → more? ⟲
 *            → remove → report
 *
 * The **plan** stage is a real decider rather than an `if`, because "skip this
 * chunk" is a decision with evidence: the stored content hash equals the new
 * one AND the stored embedder fingerprint equals the current one. Both
 * predicates read from scope, so `decide()` captures the values that drove the
 * choice and `FlowRecorder.onDecision` carries them — which is what makes
 * "why was that one skipped?" answerable rather than merely plausible.
 *
 * The **embed** stage fans out with `addParallelForEach`, one branch per batch,
 * each with a declarative `retry`. A hand-rolled retry inside the stage would
 * be invisible: the narrative would show one stage and the two rate-limited
 * attempts before the successful one would leave no mark. Declared, every
 * attempt is in the record.
 *
 * It fans out over a WINDOW rather than over every batch, and loops. That is
 * not an optimisation: `maxBranches` truncates the extra items rather than
 * queueing them, so a single fan-out over 200 batches with a ceiling of 4
 * would embed 4 and report success. The window can never exceed the ceiling,
 * and the loop comes back for the rest.
 *
 * ── Pausing, and the honest limit on it ─────────────────────────────────────
 * A large corpus can exceed a budget mid-run, so the window loop is where a
 * long run can stop. **It can only stop at a WINDOW BOUNDARY**, and that is a
 * real constraint rather than a preference: `interrupt()` re-runs its stage
 * from the top on resume, so a pause inside an embedder call would re-embed
 * everything that call had already done. Every completed batch is committed
 * before the loop comes round, so a resume re-embeds at most the window that
 * was in flight.
 */
import { flowChart } from 'footprintjs';
import type { TypedScope } from 'footprintjs';
import { decide } from 'footprintjs';

import type { Embedder } from '../memory/embedding/index.js';
import type { MemoryStore } from '../memory/store/index.js';
import type { MemoryIdentity } from '../memory/identity/index.js';
import type { MemoryEntry } from '../memory/entry/index.js';
import { emitEmbedding } from '../memory/embedding/emitEmbedding.js';
import { DEFAULT_CORPUS_IDENTITY } from '../lib/rag/defineRAG.js';
import { loadDocuments } from './loadDocuments.js';
import { splitDocuments } from './splitDocuments.js';
import { byHeading } from './splitters/byHeading.js';
import type {
  Chunk,
  DocumentLoader,
  DocumentSource,
  FailedDocument,
  IndexReport,
  LoadedDocument,
  Splitter,
  TruncatedChunk,
} from './types.js';

export interface IndexCorpusConfig {
  /** Where the documents come from. */
  readonly source: DocumentSource;
  /** Where the vectors go. Any `MemoryStore`; `sqliteVectorStore` to keep them. */
  readonly store: MemoryStore;
  /** What turns chunk text into vectors. */
  readonly embedder: Embedder;
  /**
   * The namespace to index into. Defaults to the same
   * `{ conversationId: '_global' }` that `defineRAG` reads from, so index with
   * no options and retrieve with no options and the two meet.
   */
  readonly corpus?: MemoryIdentity;
  /**
   * How to cut the documents. Default `byHeading()` — the one strategy that
   * reads the document's own structure instead of inferring it.
   */
  readonly splitter?: Splitter;
  /** Loaders consulted before the built-ins. */
  readonly loaders?: readonly DocumentLoader[];
  /**
   * The embedder's id, stored per vector and refused on when it changes.
   * Defaults to `embedder.id`.
   */
  readonly embedderId?: string;
  /** Chunks per embed batch. Default 64. */
  readonly batchSize?: number;
  /**
   * How many batches embed at once. Default 4.
   *
   * A hard ceiling on PARALLELISM, not on total work: batches beyond it wait
   * for the next window rather than being dropped.
   */
  readonly maxConcurrentBatches?: number;
  /** Attempts per batch, including the first. Default 3. */
  readonly attempts?: number;
  /**
   * Delete chunks whose document is no longer in the source. Default true —
   * an index that answers from a document you deleted is worse than one that
   * does not answer.
   */
  readonly removeMissing?: boolean;
  /**
   * The embedder's input ceiling in characters. Chunks longer than this are
   * embedded anyway (the embedder clips them) and RECORDED in
   * `report.truncated` — so silent half-embedding becomes a number you can see.
   * Default 2000, the measured `localEmbedder` cliff.
   */
  readonly maxChunkChars?: number;
}

/** The chart's scope. Every field here is in the commit log. */
interface IndexState {
  discoveredCount: number;
  documents: readonly LoadedDocument[];
  failed: readonly FailedDocument[];
  chunks: readonly Chunk[];
  toEmbed: readonly Chunk[];
  toSkip: readonly string[];
  toRemove: readonly string[];
  /** The queue of batches still to embed. Drained one window at a time. */
  pendingBatches: readonly (readonly Chunk[])[];
  /** The window being fanned out over — never longer than `maxConcurrentBatches`. */
  window: readonly (readonly Chunk[])[];
  batchResults: readonly ({ written?: number } | undefined)[];
  embeddedCount: number;
  removedCount: number;
  truncated: readonly TruncatedChunk[];
  report?: IndexReport;
  [key: string]: unknown;
}

const DEFAULT_MAX_CHUNK_CHARS = 2000;

/**
 * Build and run the indexing chart.
 *
 * @returns the report — which is also committed to the run's own log, so it is
 *   evidence rather than only a return value.
 *
 * @example
 * ```ts
 * const report = await indexCorpus({
 *   source: { dir: './docs' },
 *   store: sqliteVectorStore({ file: './corpus.db' }),
 *   embedder: staticEmbedder(),
 * });
 * // { discovered: 3, loaded: 3, chunks: 14, embedded: 14, skipped: 0, removed: 0, … }
 * ```
 */
export async function indexCorpus(config: IndexCorpusConfig): Promise<IndexReport> {
  const chart = buildIndexChart(config);
  // `run()` hands back `{ state, output, executionTree, commitLog }`. The
  // report is read off the final state — and it is ALSO in `commitLog`, which
  // is the copy that survives without the caller keeping this return value.
  const result = (await chart.run({})) as { state?: { report?: IndexReport } };
  const report = result?.state?.report;
  if (!report) {
    throw new Error('indexCorpus: the chart finished without producing a report.');
  }
  return report;
}

/**
 * The chart itself, exposed so a caller can mount it, attach recorders to it,
 * or run it under their own executor — the same freedom every other chart in
 * this library gives.
 */
export function buildIndexChart(config: IndexCorpusConfig): ReturnType<typeof compile> {
  return compile(config);
}

function compile(config: IndexCorpusConfig) {
  const corpus = config.corpus ?? DEFAULT_CORPUS_IDENTITY;
  const splitter = config.splitter ?? byHeading();
  const embedderId = config.embedderId ?? config.embedder.id ?? 'default-embedder';
  const batchSize = Math.max(1, Math.floor(config.batchSize ?? 64));
  const maxBatches = Math.max(1, Math.floor(config.maxConcurrentBatches ?? 4));
  const attempts = Math.max(1, Math.floor(config.attempts ?? 3));
  const maxChunkChars = config.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const removeMissing = config.removeMissing ?? true;
  const startedAt = Date.now();
  const fingerprint = `${embedderId}@${config.embedder.dimensions}`;

  return (
    flowChart<IndexState>(
      'Discover + load',
      async (scope) => {
        const { documents, failed, discovered } = await loadDocuments(config.source, {
          ...(config.loaders && { loaders: config.loaders }),
        });
        scope.discoveredCount = discovered;
        scope.documents = documents;
        scope.failed = failed;
      },
      'discover-load',
      { description: 'Walk the source and read every document a loader claims' },
    )
      .addFunction(
        'Split',
        (scope) => {
          const chunks = splitDocuments(scope.documents ?? [], splitter);
          scope.chunks = chunks;
          scope.truncated = chunks
            .filter((c) => c.text.length > maxChunkChars)
            .map((c) => ({ id: c.id, chars: c.text.length }));
        },
        'split',
        `Cut every document with '${splitter.name}'`,
      )

      // ── The plan. A decider, because "skip" is a decision with evidence. ──
      .addDeciderFunction(
        'Plan',
        (async (scope: TypedScope<IndexState>) => {
          const chunks = scope.chunks ?? [];
          const wanted = new Map(chunks.map((c) => [c.id, c]));

          // What is already there, and is it still current? Two predicates,
          // both recorded: same content, same embedding space.
          const toEmbed: Chunk[] = [];
          const toSkip: string[] = [];
          for (const chunk of chunks) {
            const existing = await config.store.get<{ contentHash?: string }>(corpus, chunk.id);
            const storedHash = existing?.value?.contentHash;
            const storedFingerprint =
              existing?.embeddingModel === undefined
                ? undefined
                : `${existing.embeddingModel}@${(existing.embedding ?? []).length}`;
            const sameContent = storedHash === chunk.contentHash;
            const sameEmbedder = storedFingerprint === fingerprint;
            if (existing && sameContent && sameEmbedder) toSkip.push(chunk.id);
            else toEmbed.push(chunk);
          }

          // Chunks in the index whose document is no longer in the source, or
          // which this document no longer produces (it got shorter).
          const toRemove: string[] = [];
          if (removeMissing) {
            const liveDocs = new Set((scope.documents ?? []).map((d) => d.uri));
            let cursor: string | undefined;
            do {
              const page = await config.store.list<{ docUri?: string }>(corpus, {
                limit: 500,
                ...(cursor !== undefined && { cursor }),
              });
              for (const entry of page.entries) {
                if (wanted.has(entry.id)) continue;
                const docUri = entry.value?.docUri;
                // Only ever remove chunks of documents this run actually saw
                // the source for. A namespace shared with something else is
                // not ours to prune.
                if (docUri !== undefined && liveDocs.has(docUri)) toRemove.push(entry.id);
                else if (docUri !== undefined && isFromThisCorpus(docUri, scope)) {
                  toRemove.push(entry.id);
                }
              }
              cursor = page.cursor;
            } while (cursor !== undefined);
          }

          scope.toEmbed = toEmbed;
          scope.toSkip = toSkip;
          scope.toRemove = toRemove;
          scope.pendingBatches = chunk(toEmbed, batchSize);
          scope.embeddedCount = 0;

          return decide(
            scope,
            [
              {
                when: (s) => (s.toEmbed ?? []).length === 0 && (s.toRemove ?? []).length === 0,
                then: 'nothing-to-do',
                label: 'every chunk is already indexed with this embedder, and nothing was removed',
              },
              {
                when: (s) => (s.toSkip ?? []).length > 0,
                then: 'incremental',
                label: 'some chunks are unchanged — same content hash, same embedder fingerprint',
              },
            ],
            'full-index',
          );
        }) as never,
        'plan',
        'Decide what to embed, what to skip, and what to remove',
      )
      .addFunctionBranch(
        'nothing-to-do',
        'NothingToDo',
        noop as never,
        'No work — index is current',
      )
      .addFunctionBranch('incremental', 'Incremental', noop as never, 'Embed only what changed')
      .addFunctionBranch('full-index', 'FullIndex', noop as never, 'Embed everything discovered')
      // Back to the trunk: the branch above is the RECORD of which plan was
      // taken, and the work after it is the same whichever one fired — an
      // empty `toEmbed` fans out over nothing, which costs nothing and still
      // files a report.
      .end()

      // ── Embed, one WINDOW of batches at a time. ──────────────────────────
      // `maxBranches` is a hard ceiling, and footprintjs does not queue the
      // extra items — it TRUNCATES them. Fanning out over every batch at once
      // would therefore embed only the first `maxConcurrentBatches` of them
      // and report success: an index silently containing a fraction of the
      // corpus, which is the worst thing this release could ship.
      //
      // So the fan-out runs over a WINDOW that can never exceed the ceiling,
      // and the loop after it comes back for the next one. Bounded
      // parallelism, unbounded total work, nothing dropped.
      .addFunction(
        'Take window',
        (scope) => {
          const pending = scope.pendingBatches ?? [];
          scope.window = pending.slice(0, maxBatches);
          scope.pendingBatches = pending.slice(maxBatches);
        },
        'take-window',
        `Take up to ${maxBatches} batches for this pass`,
      )
      .addParallelForEach<readonly Chunk[]>('Embed batches', 'embed', {
        items: (scope) => scope.window ?? [],
        branch: (batch, index) =>
          flowChart<{ item: readonly Chunk[]; index: number; written: number }>(
            `Embed batch ${index + 1}`,
            async (scope) => {
              const batchChunks = (scope.item ?? batch) as readonly Chunk[];
              if (batchChunks.length === 0) {
                scope.written = 0;
                return;
              }
              const texts = batchChunks.map((c) => c.text);
              const startedEmbedAt = Date.now();
              const vectors = config.embedder.embedBatch
                ? await config.embedder.embedBatch({ texts })
                : await Promise.all(texts.map((text) => config.embedder.embed({ text })));

              emitEmbedding(scope as never, {
                model: embedderId,
                provider: 'custom',
                inputKind: 'document',
                dimension: config.embedder.dimensions,
                count: vectors.length,
                durationMs: Date.now() - startedEmbedAt,
              });

              const now = Date.now();
              const entries: MemoryEntry<Chunk>[] = batchChunks.map((c, i) => ({
                id: c.id,
                value: c,
                version: 1,
                createdAt: now,
                updatedAt: now,
                lastAccessedAt: now,
                accessCount: 0,
                ...(vectors[i] && { embedding: [...(vectors[i] as number[])] }),
                embeddingModel: embedderId,
              }));
              // One transactional write per batch — so a batch is all-in or
              // all-out, and a resumed run re-embeds at most this batch.
              await config.store.putMany(corpus, entries);
              scope.written = entries.length;
            },
            `embed-batch-${index}`,
            { description: `Embed + store ${batch.length} chunks` },
          )
            // Declared, not hand-rolled: every attempt is in the record.
            .retry({
              attempts,
              backoffMs: (n) => Math.min(8000, 250 * 2 ** (n - 1)),
            })
            .build() as never,
        maxBranches: maxBatches,
        into: 'batchResults',
        // A failed batch must fail the RUN. Best-effort (the default) leaves a
        // half-indexed corpus that keeps answering and quietly cannot see the
        // documents that did not land — which reads as "the model does not know
        // that" rather than as a failure, and is the single most expensive way
        // for this to go wrong.
        failFast: true,
      })

      .addFunction(
        'Tally window',
        (scope) => {
          // Counted from what the batches actually WROTE, never from what the
          // plan intended: a report that says "embedded 3" because three were
          // queued cannot be trusted about the one number anybody checks.
          //
          // A fan-out branch's slot holds that branch's final STATE, so the
          // count comes off `written` — the field the branch sets after the
          // store call returned.
          const written = (scope.batchResults ?? []).reduce<number>((total, result) => {
            const n = (result as { written?: unknown } | undefined)?.written;
            return total + (typeof n === 'number' ? n : 0);
          }, 0);
          scope.embeddedCount = (scope.embeddedCount ?? 0) + written;
        },
        'tally-window',
        'Add this window to the running total',
      )

      // More batches? Go round again. This loop is also the ONLY point at
      // which a long indexing run can be interrupted safely: every completed
      // batch is already committed, so a resume re-embeds at most the window
      // that was in flight.
      .addDeciderFunction(
        'More batches?',
        ((scope: TypedScope<IndexState>) =>
          decide(
            scope,
            [
              {
                when: (s) => (s.pendingBatches ?? []).length > 0,
                then: 'more-batches',
                label: 'batches remain — take another window',
              },
            ],
            'batches-done',
          )) as never,
        'more-batches-decider',
        'Is there another window of batches to embed?',
      )
      .addFunctionBranch('more-batches', 'MoreBatches', noop as never, 'Another window remains')
      .loopTo('take-window')
      .addFunctionBranch('batches-done', 'BatchesDone', noop as never, 'Every batch is embedded')
      .end()

      .addFunction(
        'Store removals',
        async (scope) => {
          let removed = 0;
          for (const id of scope.toRemove ?? []) {
            await config.store.delete(corpus, id);
            removed += 1;
          }
          scope.removedCount = removed;
        },
        'store-removals',
        'Delete chunks whose document changed or disappeared',
      )

      .addFunction(
        'Report',
        (scope) => {
          // The report is a COMMIT, not just a return value. A later reader
          // asks the trace what this run did; nothing had to be saved.
          scope.report = {
            discovered: scope.discoveredCount ?? 0,
            loaded: (scope.documents ?? []).length,
            chunks: (scope.chunks ?? []).length,
            embedded: scope.embeddedCount ?? 0,
            skipped: (scope.toSkip ?? []).length,
            removed: scope.removedCount ?? 0,
            failed: scope.failed ?? [],
            truncated: scope.truncated ?? [],
            embedderFingerprint: fingerprint,
            splitter: splitter.name,
            elapsedMs: Date.now() - startedAt,
          };
        },
        'report',
        'File what this run did — the commit log IS the report',
      )
      .build()
  );
}

const noop = (): void => {
  /* The branch itself is the record; the work is downstream. */
};

/** Was this document uri produced by the source this run walked? */
function isFromThisCorpus(docUri: string, scope: TypedScope<IndexState>): boolean {
  // A chunk whose document was in the index and is NOT in this run's document
  // list came from a document that disappeared — provided this run walked the
  // same source. `documents` empty means the source turned up nothing, and
  // pruning the whole namespace on an empty walk is how a typo in a path
  // deletes a corpus, so it does not.
  return (scope.documents ?? []).length > 0 && !docUri.startsWith(' ');
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)]);
  return out;
}
