/**
 * assertServesVectors — the refusal a corpus-building call owes its caller
 * when the store it was handed cannot serve vectors back.
 *
 * Pattern: guard clause over a declared port capability.
 * Role:    memory/store layer, next to the port whose one bit it reads.
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
const VECTOR_CAPABLE = 'InMemoryStore (dev/tests) or sqliteVectorStore (durable, one file)';

/**
 * Refuse a store that has declared it cannot rank the vectors it is given.
 *
 * @param store  the store the caller passed.
 * @param caller the function name to put in the message — the call the
 *               reader actually wrote, not this helper.
 * @throws when `store.supportsVectorSearch === false`. Never throws on a
 *         store that declares nothing.
 */
export function assertServesVectors(store: MemoryStore, caller: string): void {
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
