/**
 * defineRAG — retrieval-augmented generation over a document corpus.
 *
 * Embed the user's question, retrieve the most similar chunks from a
 * vector store, inject them into the system-prompt slot of the next LLM
 * call. It is the same machinery as `defineMemory({ type: SEMANTIC,
 * strategy: TOP_K })` — with three differences that are not cosmetic:
 *
 *   defineMemory ─┬─► EPISODIC   (raw conversation)
 *                 ├─► SEMANTIC   (extracted facts / RAG chunks)
 *                 ├─► NARRATIVE  (beats / summaries)
 *                 └─► CAUSAL     (footprintjs decision snapshots)
 *
 *   defineRAG    ─►  SEMANTIC + TOP_K, READ-ONLY, over a NAMED CORPUS,
 *                    rendered as citable <source> blocks.
 *
 * ─── What changed in 8.8.0, and why ────────────────────────────────────
 *
 * **1. A corpus is read-only.** Until 8.8.0 `defineRAG` also mounted the
 * semantic pipeline's WRITE half, which embedded every conversation turn
 * and stored it in the same namespace as the documents. The consequence
 * was measurable and bad: the user's own question, re-embedded, is the
 * single best-scoring "document" in the corpus (cosine 1.0 against
 * itself), so it came back as retrieval hit #1 and consumed a slot in
 * the top-K budget that a real passage should have had. A corpus is not
 * a conversation log. Nothing this retriever reads is written back.
 *
 * If you want conversation memory ALONGSIDE a corpus, that is what
 * `defineMemory` is for, and the two are registered separately, each
 * with its own store:
 *
 * ```ts
 * const agent = Agent.create({ provider })
 *   .rag(defineRAG({ id: 'product-docs', store: corpusStore, embedder }))
 *   .memory(defineMemory({
 *     id: 'chat',
 *     type: MEMORY_TYPES.EPISODIC,
 *     strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
 *     store: conversationStore,
 *   }))
 *   .build();
 * ```
 *
 * **2. The corpus has its own namespace.** A memory reads under the
 * identity passed to `agent.run()`. For conversation recall that is
 * right. For a shared corpus it was the reason the documented example
 * retrieved NOTHING: `indexDocuments` writes under
 * `{ conversationId: '_global' }` by default, while a run with no
 * explicit identity gets `{ conversationId: 'run-<timestamp>-<n>' }` —
 * so the write side and the read side never met, silently. `corpus`
 * defaults to the same `'_global'` the indexer uses, so the documented
 * example works with no extra arguments; pass it explicitly when you
 * index per tenant.
 *
 * **3. Chunks are citable.** Retrieved passages render as
 * `<source id="refunds.md#3" doc="refunds.md" score="0.81">` under a
 * corpus header, instead of the conversation-recall shape that printed
 * `role="unknown" turn="0"` on a page of a PDF and gave the model
 * nothing to cite.
 *
 * Pattern: Composition over duplication — defineRAG returns a
 *          MemoryDefinition produced by defineMemory. No new engine
 *          code, no new slot subflow, no new stage.
 *
 * Role:    Layer-3 context-engineering primitive. Lives next to
 *          defineSkill / defineSteering / defineInstruction / defineFact
 *          but resolves to a memory subflow rather than an Injection
 *          (RAG content is computed at runtime via async retrieval —
 *          can't fit the synchronous Injection.inject shape).
 *
 * Emits:   `agentfootprint.memory.retrieved` (once per retrieval, with
 *          every candidate and its score — including the rejected ones),
 *          `agentfootprint.memory.attached` (once per chunk that reached
 *          the prompt), and `agentfootprint.context.injected` with
 *          `source: 'rag'` (once per chunk).
 *
 * @see ./indexDocuments.ts  for the seeding helper
 * @see ../../memory/define.ts  for the underlying factory
 * @see ../../memory/retrieval/  for the retrieval seam
 * @see ../../memory/asRoleRefusal.ts  for why `asRole` is refused, not honoured
 *
 * @example  Basic usage — works with no identity argument anywhere
 * ```ts
 * import { Agent, defineRAG, indexDocuments } from 'agentfootprint';
 * import { InMemoryStore, mockEmbedder } from 'agentfootprint/memory';
 * import { mock } from 'agentfootprint/providers';
 *
 * const embedder = mockEmbedder();
 * const store = new InMemoryStore();
 *
 * // Seed the corpus once at startup (defaults to the '_global' namespace).
 * await indexDocuments(store, embedder, [
 *   { id: 'refunds.md#0', content: 'Refunds are processed within 3 business days.',
 *     metadata: { source: 'refunds.md' } },
 *   { id: 'pricing.md#0', content: 'Pro plan costs $20/month.',
 *     metadata: { source: 'pricing.md' } },
 * ]);
 *
 * const docs = defineRAG({
 *   id: 'product-docs',
 *   description: 'Retrieve product documentation chunks',
 *   store,
 *   embedder,
 *   topK: 3,
 *   threshold: 0.6,
 * });
 *
 * const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock' })
 *   .rag(docs)
 *   .build();
 *
 * agent.on('agentfootprint.memory.retrieved', (e) => {
 *   // every candidate, admitted or not, with its score and its reason
 *   console.log(e.payload.candidates);
 * });
 *
 * await agent.run({ message: 'How long do refunds take?' });
 * ```
 */

import type { Embedder } from '../../memory/embedding/index.js';
import type { MemoryStore } from '../../memory/store/index.js';
import type { MemoryIdentity } from '../../memory/identity/index.js';
import type { MemoryDefinition } from '../../memory/define.types.js';
import type { RetrievalStrategy } from '../../memory/retrieval/index.js';
import { MEMORY_TYPES, MEMORY_STRATEGIES } from '../../memory/define.types.js';
import { defineMemory } from '../../memory/define.js';
import { refuseAsRole } from '../../memory/asRoleRefusal.js';

/**
 * The namespace a corpus lives in unless told otherwise — the same one
 * `indexDocuments` writes to by default. The two defaults are one value
 * on purpose: index with no options, retrieve with no options, and the
 * documents are found.
 */
export const DEFAULT_CORPUS_IDENTITY: MemoryIdentity = { conversationId: '_global' };

export interface DefineRAGOptions {
  /** Stable id. Becomes the scope-key suffix and the Lens label. */
  readonly id: string;

  /**
   * Human-readable description. Surfaces in narrative + Lens hover.
   * Recommend describing the *corpus* (e.g., "Product documentation
   * chunks indexed weekly from docs.example.com").
   */
  readonly description?: string;

  /**
   * Vector-capable store containing the indexed corpus. Must implement
   * `search()`. Use `indexDocuments(store, embedder, docs)` at startup
   * to populate it. Ships with `InMemoryStore` for dev/tests; swap to
   * a durable adapter in production.
   */
  readonly store: MemoryStore;

  /**
   * Embedder used for the read-side query. Pass the SAME embedder
   * instance (or one with the same `embedderId`) that was used for
   * indexing — cross-model similarity scores are not comparable.
   */
  readonly embedder: Embedder;

  /**
   * Stable id of the embedder. Stored on entries during indexing
   * (via `indexDocuments`) and filtered at search time so a later
   * embedder swap doesn't pollute results.
   */
  readonly embedderId?: string;

  /**
   * The namespace this corpus lives in. Default
   * `{ conversationId: '_global' }` — the same default `indexDocuments`
   * writes to, so the plain path needs no argument on either side.
   *
   * A corpus is deliberately NOT scoped to the run's identity: it is
   * shared by every conversation, and reading it under a per-run
   * conversation id is the bug this default fixes.
   *
   * **Multi-tenant:** pass the tenant's identity here AND the same one to
   * `indexDocuments({ identity })`. A namespace that holds nothing is now
   * reported (`corpusEmpty` on `agentfootprint.memory.retrieved`, plus a
   * one-time warning naming the namespace), so a mismatch is loud rather
   * than an empty answer.
   */
  readonly corpus?: MemoryIdentity;

  /**
   * Top-K chunks to retrieve per turn. Default 3 (balanced —
   * defends against lost-in-the-middle while giving multiple
   * perspectives). Increase for richer context, decrease for cost.
   *
   * Shorthand for `retrieval: topK({ k })`; the two EXCLUDE.
   */
  readonly topK?: number;

  /**
   * Minimum cosine similarity to inject. **Strict** — when no chunk
   * meets the threshold, NO injection happens (no fallback that would
   * pollute the prompt with weak matches). Default 0.7.
   *
   * Tuning note: the right threshold is a property of the EMBEDDER. 0.7
   * is a high bar for some of them. Sentence-BERT relatives
   * (`all-MiniLM-L6-v2`, etc.) often score 0.4–0.6 even on relevant
   * chunks; Amazon Titan Text V2 was field-measured at 0.55–0.57 for a
   * direct hit, ~0.49 for the right section diluted, 0.36–0.42 for
   * noise — on that embedder the 0.7 default retrieves NOTHING,
   * silently. You no longer have to guess: the rejected candidates and
   * their scores are on every `agentfootprint.memory.retrieved` event,
   * so the right threshold is a number you can read off a run.
   *
   * Shorthand for `retrieval: topK({ threshold })`; the two EXCLUDE.
   */
  readonly threshold?: number;

  /**
   * A character budget for the retrieved passages, spent across them in
   * RANK order (8.19.0). Default: none — `topK` stays the only bound, so
   * nothing changes for a retriever that does not ask for this.
   *
   * **A count bound is not a size bound.** `topK` says how many passages
   * may reach the prompt and nothing about how long they are: ten chunks
   * cut by `byHeading()` off ordinary documentation measured 11,153
   * characters in the field, against a `systemPrompt` slot whose default
   * budget is 4,000 — an overflow produced entirely by defaults on both
   * sides. Nothing truncates (the slot warns and emits
   * `agentfootprint.context.budget_pressure`), so the run was honest about
   * the over-run and had no way to BOUND it. This is that bound.
   *
   * The two numbers, side by side, because they are the ones that meet:
   *
   * | knob | default | what it bounds |
   * |---|---|---|
   * | `defineRAG({ topK })` | 3 | how MANY passages |
   * | `defineRAG({ maxChars })` | none | how much TEXT they may be |
   * | `Agent.create({ contextBudget: { systemPrompt } })` | 4000 chars | the whole slot they land in |
   *
   * Retrieved passages share that slot with the system prompt, steering,
   * facts and skill bodies, so a budget of roughly half the slot is a
   * sane starting point: `maxChars: 2000` with the 4,000-char default.
   *
   * The spend is RECORDED, never silent: passages past the budget are
   * refused with `reason: 'over-char-budget'` on
   * `agentfootprint.memory.retrieved`, and the record carries `maxChars`
   * and `charsUsed`. Rank order, tail dropped — so a budget smaller than
   * the best-scoring passage admits nothing and says so per candidate,
   * rather than quietly injecting half a passage.
   *
   * NOT the splitters' `maxChars`: `byHeading({ maxChars })` bounds ONE
   * chunk at index time (default 1000), this bounds the WHOLE retrieved set
   * at query time. The first is why the arithmetic above lands where it
   * does — ten chunks off a 1000-char splitter is ten thousand characters
   * before a single tag is added.
   *
   * Composes with `retrieval` (unlike `topK`/`threshold`, which exclude
   * it): the strategy picks the candidates, this bounds their size.
   */
  readonly maxChars?: number;

  /**
   * The retrieval rule, spelled out. Replaces `topK` + `threshold`
   * entirely — passing both is refused, because they could disagree
   * and the recording would then name a `k` the run did not use.
   *
   * ```ts
   * import { topK } from 'agentfootprint/memory';
   * defineRAG({ id, store, embedder, retrieval: topK({ k: 5, threshold: 0.55 }) });
   * ```
   *
   * A cross-encoder re-ranker and a diversity (MMR) selector are the
   * next two adapters behind this same interface; neither ships in
   * 8.8.0, and the seam exists so that when they do, nothing else moves.
   */
  readonly retrieval?: RetrievalStrategy;

  // NOTE (7.20.0): `asRole?: ContextRole` used to sit here, documented as
  // defaulting to `'user'` with a paragraph of reasoning about tool-using
  // ReAct loops. Nothing ever read it — retrieved chunks are formatted by
  // `formatDefault`, which writes `role: 'system'` unconditionally — so
  // the documented default described a behaviour that never happened.
  // Removing it is what makes TypeScript report the declaration at the
  // keystroke; `defineRAG` throws for JavaScript callers and casts. See
  // `../../memory/asRoleRefusal.ts`.
}

/**
 * Build a RAG context-engineering definition. The returned
 * `MemoryDefinition` is registered on the Agent via `.rag(definition)`
 * (or, equivalently, `.memory(definition)` — same plumbing).
 *
 * @throws when `store` does not implement `search()`. RAG requires a
 *         vector-capable adapter.
 * @throws when `retrieval` is combined with `topK` or `threshold`.
 */
export function defineRAG(opts: DefineRAGOptions): MemoryDefinition {
  if (!opts.id || opts.id.trim() === '') {
    throw new Error('defineRAG: `id` is required and must be non-empty.');
  }
  // `asRole` no longer type-checks; this catches JavaScript callers and
  // casts. Refused here rather than only inside `defineMemory` so the
  // message names the factory the caller actually wrote.
  refuseAsRole(opts, `defineRAG('${opts.id}')`);
  if (!opts.store) {
    throw new Error(`defineRAG[${opts.id}]: \`store\` is required.`);
  }
  if (!opts.embedder) {
    throw new Error(`defineRAG[${opts.id}]: \`embedder\` is required.`);
  }
  if (!opts.store.search) {
    throw new Error(
      `defineRAG[${opts.id}]: store must implement search(). ` +
        'Pass a vector-capable adapter (InMemoryStore, pgvector, Pinecone, ...).',
    );
  }
  if (opts.maxChars !== undefined && (!Number.isFinite(opts.maxChars) || opts.maxChars < 1)) {
    throw new Error(
      `defineRAG[${opts.id}]: \`maxChars\` must be a positive number of characters — received ` +
        `${String(opts.maxChars)}. A budget of zero admits no passage at all, which is what ` +
        'leaving `maxChars` unset already means (no size bound); say what you want spent.',
    );
  }
  if (opts.retrieval !== undefined) {
    const shorthand: string[] = [];
    if (opts.topK !== undefined) shorthand.push('`topK`');
    if (opts.threshold !== undefined) shorthand.push('`threshold`');
    if (shorthand.length > 0) {
      throw new Error(
        `defineRAG[${opts.id}]: ${shorthand.join(' and ')} cannot be combined with \`retrieval\` ` +
          '— they are two spellings of the same rule and could disagree. Keep ' +
          `\`retrieval: ${opts.retrieval.name}({ ... })\` and drop ${shorthand.join('/')}.`,
      );
    }
  }

  return defineMemory({
    id: opts.id,
    ...(opts.description !== undefined && { description: opts.description }),
    type: MEMORY_TYPES.SEMANTIC,
    strategy:
      opts.retrieval !== undefined
        ? {
            kind: MEMORY_STRATEGIES.TOP_K,
            embedder: opts.embedder,
            retrieval: opts.retrieval,
            ...(opts.embedderId !== undefined && { embedderId: opts.embedderId }),
            // Rides BOTH arms: the rule chooses the passages, this bounds
            // how much text the chosen ones are allowed to be.
            ...(opts.maxChars !== undefined && { maxChars: opts.maxChars }),
          }
        : {
            kind: MEMORY_STRATEGIES.TOP_K,
            topK: opts.topK ?? 3,
            threshold: opts.threshold ?? 0.7,
            embedder: opts.embedder,
            ...(opts.embedderId !== undefined && { embedderId: opts.embedderId }),
            ...(opts.maxChars !== undefined && { maxChars: opts.maxChars }),
          },
    store: opts.store,
    // A corpus is not a conversation log — see the header.
    readOnly: true,
    corpus: opts.corpus ?? DEFAULT_CORPUS_IDENTITY,
    flavor: 'rag',
  });
}
