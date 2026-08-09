/**
 * Store capabilities — the two declared facts a store may state about its own
 * `search()`, and the refusals they buy.
 *
 * Pattern: guard clauses over declared port capabilities.
 * Role:    memory/store layer, next to the port whose bits they read.
 * Emits:   N/A.
 *
 * ── The failure this exists to end ──────────────────────────────────────────
 * `MemoryStore.search` is optional, so "can this store rank vectors?" was
 * answered by `if (store.search)` everywhere — a check that asks whether the
 * METHOD exists. Some stores implement `search()` and rank on their own side
 * over a population they derived themselves: `AgentCoreStore.search()` takes
 * the query as TEXT and returns the memory records AgentCore's extraction
 * strategies built, not the entries this library wrote. Handed one of those,
 * `indexCorpus` type-checks, runs, embeds the whole corpus, pays for it, and
 * reports `embedded: 214` — and not one of those 214 chunks can ever come
 * back. The index is real. The retrieval is empty. Nothing anywhere says so.
 *
 * A method's presence cannot express that, so the port grew one declared bit
 * ({@link MemoryStore.supportsVectorSearch}) and this is the one place that
 * reads it. **Absence is not a `false`**: a store that declares nothing is
 * treated exactly as it was before this existed, which is what keeps every
 * third-party adapter working unchanged.
 */
import type { MemoryStore } from './types.js';

/** The stores this library ships that DO rank the vectors they were given. */
const VECTOR_CAPABLE =
  'InMemoryStore (dev/tests), sqliteVectorStore (durable, one file), pgVectorStore ' +
  '(Postgres + pgvector) or s3VectorsStore (Amazon S3 Vectors)';

/**
 * The ranking mode a store DECLARES, with a contradiction refused by name.
 *
 * Two members answer two questions ({@link MemoryStore.supportsVectorSearch}
 * "can you serve my vectors back?" and {@link MemoryStore.ranksBy} "what query
 * form does your search take?"), and a store may state either, both, or
 * neither. Both, disagreeing, is the one case that cannot be resolved: there is
 * no reading of `{ supportsVectorSearch: true, ranksBy: 'server-text' }` that
 * is not somebody's bug, and picking a winner would encode a guess about which
 * line was the mistake. Refused — the same law that refuses `topK` beside
 * `retrieval`.
 *
 * @returns `'vector'` | `'server-text'` | `undefined` (undeclared — the state
 *          every adapter written before 9.3.0 is in, and the one that must
 *          change nothing).
 * @throws when the two declarations contradict each other.
 */
export function resolveRankingMode(
  store: MemoryStore,
  caller: string,
): 'vector' | 'server-text' | undefined {
  const declared = store.ranksBy;
  const servesVectors = store.supportsVectorSearch;
  if (declared === undefined) {
    // A bare `supportsVectorSearch: true` is a store saying it ranks the
    // vectors it was given, which IS `'vector'` — read it as one, so a
    // pre-9.3.0 adapter gets the new behaviour without a new line. A bare
    // `false` says only that it cannot serve them back, not how it ranks, so
    // it stays undeclared here.
    return servesVectors === true ? 'vector' : undefined;
  }
  if (declared === 'vector' && servesVectors === false) {
    throw new Error(contradiction(store, caller, 'vector', false));
  }
  if (declared === 'server-text' && servesVectors === true) {
    throw new Error(contradiction(store, caller, 'server-text', true));
  }
  return declared;
}

function contradiction(
  store: MemoryStore,
  caller: string,
  ranksBy: 'vector' | 'server-text',
  supportsVectorSearch: boolean,
): string {
  const name = storeName(store);
  return (
    `${caller}: \`${name}\` declares \`ranksBy: '${ranksBy}'\` and ` +
    `\`supportsVectorSearch: ${String(supportsVectorSearch)}\`, and those two cannot both be ` +
    `true.\n` +
    `  \`ranksBy: 'vector'\` means search() ranks the embeddings you wrote, which is exactly ` +
    `what \`supportsVectorSearch: true\` claims; \`'server-text'\` means the backend ranks ` +
    `text on its own side, which is exactly what \`false\` admits.\n` +
    `  Fix:  keep ONE of them. A local vector backend declares ` +
    `\`ranksBy: 'vector'\` (or nothing but \`supportsVectorSearch: true\`); a managed ` +
    `text-ranking backend declares \`ranksBy: 'server-text'\` and \`supportsVectorSearch: false\`.\n` +
    `  This refuses rather than picking a winner — either line could be the mistake, and ` +
    `guessing which would silently decide whether your queries get embedded.`
  );
}

/**
 * Refuse a store that has declared it cannot rank the vectors it is given.
 *
 * @param store  the store the caller passed.
 * @param caller the function name to put in the message — the call the
 *               reader actually wrote, not this helper.
 * @throws when `store.supportsVectorSearch === false`, when it declares
 *         `ranksBy: 'server-text'`, or when the two declarations contradict.
 *         Never throws on a store that declares nothing.
 */
export function assertServesVectors(store: MemoryStore, caller: string): void {
  // A contradiction is refused here too — a corpus builder is usually the
  // FIRST call a new store meets, and it is the cheapest place to find out.
  const mode = resolveRankingMode(store, caller);
  if (mode === 'server-text') {
    throw new Error(
      `${caller}: \`${storeName(store)}\` declares \`ranksBy: 'server-text'\`, so indexing a ` +
        `corpus into it would report success and retrieve nothing.\n` +
        `  It embeds and ranks on the BACKEND's side, over a population the backend derived ` +
        `itself — the vectors written here would be stored and never read.\n` +
        `  Fix:  index into a vector-ranking store — ${VECTOR_CAPABLE}.\n` +
        `  Or:   let the backend do its own ingestion (its console, its API), and point ` +
        `\`defineRAG\` at it with NO embedder — a server-text store takes the question as ` +
        `words, so there is nothing for this library to embed.`,
    );
  }
  if (store.supportsVectorSearch !== false) return;
  const name = storeName(store);
  // Two ways a store can be unable to serve vectors back, and the message
  // must not describe the wrong one: a store with a `search()` ranks over
  // something ELSE, a store without one ranks nothing at all.
  const why =
    typeof store.search === 'function'
      ? `its search() ranks on the SERVER's side, over a population the backend derived ` +
        `itself, and never over the embeddings written here`
      : `it implements no search() at all, so nothing will ever rank the embeddings ` +
        `written here`;
  throw new Error(
    `${caller}: \`${name}\` cannot serve vectors back, so indexing a corpus into it would ` +
      `report success and retrieve nothing.\n` +
      `  It declares \`supportsVectorSearch: false\`: ${why}. The vectors would be stored ` +
      `and never read.\n` +
      `  Fix:  index into a vector-capable store — ${VECTOR_CAPABLE}, or any adapter that ` +
      `ranks the vectors you give it (pgvector, Pinecone, Qdrant, ...).\n` +
      `  Keep \`${name}\` for what it is good at: conversation memory through ` +
      `\`defineMemory\`, where the backend's own storage and retrieval are the point.`,
  );
}

/** The store's class name when it has one, so the message names what was passed. */
function storeName(store: MemoryStore): string {
  const ctor = (store as { constructor?: { name?: string } }).constructor;
  const name = typeof ctor?.name === 'string' ? ctor.name : '';
  return name.length > 0 && name !== 'Object' ? name : 'the store you passed';
}
