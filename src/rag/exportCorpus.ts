/**
 * exportCorpus / importCorpus — a corpus as a build artifact.
 *
 * Pattern: projection (store → plain-JSON bundle) and its inverse.
 * Role:    rag/ layer — the build-time half of the story whose runtime half
 *          is `staticVectorStore` (`agentfootprint/memory`). Index where the
 *          credentials and the durable disk live; ship the bundle with the
 *          deploy; serve it read-only where the process runs.
 * Emits:   N/A — build-step helpers, not run-time stages.
 *
 * ── The deployment shape this exists for ────────────────────────────────────
 * An immutable or serverless runtime loses its disk between invocations and
 * often holds no embedding-API credentials — while the build machine has
 * both. So the corpus becomes an artifact of the BUILD:
 *
 *   // build step (cron, CI, deploy hook) — credentials live here
 *   const report = await indexFolder('./docs', { to: store, embedder });
 *   writeFileSync('corpus.json', JSON.stringify(await exportCorpus(store)));
 *
 *   // runtime — no disk, no embedding writes, no drift
 *   const store = staticVectorStore(JSON.parse(readFileSync('corpus.json', 'utf8')), embedder);
 *   const docs = defineRAG({ id: 'docs', store, embedder });
 *
 * The bundle records the embedder id and dimensions it was built with, so the
 * runtime can REFUSE a mismatched embedder at load instead of discovering it
 * as an empty retrieval — the same fingerprint discipline the durable store
 * enforces per write.
 *
 * `importCorpus` is the inverse for a WRITABLE store: load a bundle into
 * InMemoryStore at boot, or into sqliteVectorStore to migrate a corpus
 * between machines without re-embedding (and re-billing) anything.
 */
import type { MemoryStore } from '../memory/store/index.js';
import { assertServesVectors } from '../memory/store/capability.js';
import type { MemoryIdentity } from '../memory/identity/index.js';
import { identityNamespace } from '../memory/identity/index.js';
import type { MemoryEntry } from '../memory/entry/index.js';
import { chunkText } from '../memory/retrieval/provenance.js';
import {
  CORPUS_BUNDLE_FORMAT,
  assertCorpusBundle,
  bundleEntryToMemoryEntry,
  type CorpusBundle,
  type CorpusBundleEntry,
} from '../memory/store/staticVectorStore.js';
import { DEFAULT_CORPUS_IDENTITY } from '../lib/rag/defineRAG.js';

/**
 * Export every entry of a corpus namespace as a plain-JSON bundle.
 *
 * @param store    the store the corpus was indexed into. Any `MemoryStore`
 *                 that can `list` — the reference stores and the durable one
 *                 all can.
 * @param identity the namespace to export. Defaults to the same
 *                 `{ conversationId: '_global' }` that `indexCorpus`,
 *                 `indexFolder`, `indexDocuments` and `defineRAG` default to,
 *                 so the plain path needs no argument anywhere.
 *
 * @throws when the namespace is empty (almost always an identity mismatch,
 *         named as such), when an entry carries no vector or no passage (a
 *         bundle never ships an unservable entry), or when the namespace
 *         mixes embedding spaces (two spaces in one bundle could never be
 *         served by one embedder).
 */
export async function exportCorpus(
  store: MemoryStore,
  identity: MemoryIdentity = DEFAULT_CORPUS_IDENTITY,
): Promise<CorpusBundle> {
  if (!store) throw new Error('exportCorpus: `store` is required.');
  const namespace = identityNamespace(identity);

  const collected: MemoryEntry<unknown>[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list(identity, {
      limit: 500,
      ...(cursor !== undefined && { cursor }),
    });
    collected.push(...page.entries);
    cursor = page.cursor;
  } while (cursor !== undefined);

  if (collected.length === 0) {
    throw new Error(
      `exportCorpus: namespace '${namespace}' holds no entries at all. The usual cause is an ` +
        `identity mismatch: the corpus was indexed under a different identity than the one ` +
        `being exported. indexCorpus/indexFolder/indexDocuments default to ` +
        `{ conversationId: '_global' } — pass the same \`identity\` here that you indexed ` +
        `under.`,
    );
  }

  // Every entry must be servable: a vector (or it can never be retrieved) and
  // a passage (or its retrieval renders a blank citation). Named, bounded.
  const noVector: string[] = [];
  const noPassage: string[] = [];
  const spaces = new Map<string, number>(); // '<id>@<dims>' → count
  for (const entry of collected) {
    const vector = entry.embedding;
    if (!vector || vector.length === 0) {
      noVector.push(entry.id);
      continue;
    }
    if (chunkText(entry.value).trim().length === 0) noPassage.push(entry.id);
    const space = `${entry.embeddingModel ?? 'default-embedder'}@${vector.length}`;
    spaces.set(space, (spaces.get(space) ?? 0) + 1);
  }
  if (noVector.length > 0) {
    throw new Error(
      `exportCorpus: ${noVector.length} entr${noVector.length === 1 ? 'y' : 'ies'} in ` +
        `'${namespace}' carr${noVector.length === 1 ? 'ies' : 'y'} no embedding vector: ` +
        `${sample(noVector)}. A bundle entry without a vector could never be retrieved. ` +
        `This namespace holds more than an indexed corpus (conversation memory shares it?) — ` +
        `export a namespace that holds only the corpus, or re-index it.`,
    );
  }
  if (noPassage.length > 0) {
    throw new Error(
      `exportCorpus: ${noPassage.length} entr${noPassage.length === 1 ? 'y' : 'ies'} in ` +
        `'${namespace}' carr${noPassage.length === 1 ? 'ies' : 'y'} no passage (neither ` +
        `\`content\` nor \`text\` on the value): ${sample(noPassage)}. A citable id with ` +
        `nothing to cite is the blank-citation bug; a bundle never ships one.`,
    );
  }
  if (spaces.size > 1) {
    throw new Error(
      `exportCorpus: namespace '${namespace}' mixes ${spaces.size} embedding spaces ` +
        `(${[...spaces.entries()].map(([s, n]) => `'${s}' ×${n}`).join(', ')}). One bundle ` +
        `serves one space — no single query embedder could search both. Re-index the ` +
        `namespace with one embedder, then export.`,
    );
  }

  // Exactly one space — parse it back apart. The id may itself contain '@'
  // (provider-prefixed ids do), so split on the LAST one.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const space = [...spaces.keys()][0]!;
  const at = space.lastIndexOf('@');
  const embedderId = space.slice(0, at);
  const dimensions = Number(space.slice(at + 1));

  const entries: CorpusBundleEntry[] = collected.map((entry) => {
    const metadata = flattenMetadata(entry);
    return {
      id: entry.id,
      text: chunkText(entry.value),
      // Validated non-empty above.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      vector: [...entry.embedding!],
      ...(metadata !== undefined && { metadata }),
    };
  });

  return {
    format: CORPUS_BUNDLE_FORMAT,
    embedder: { id: embedderId, dimensions },
    namespace,
    exportedAt: Date.now(),
    entries,
  };
}

/**
 * Load a bundle into a WRITABLE vector-capable store — the inverse of
 * `exportCorpus`. Use it to seed an `InMemoryStore` at boot from a shipped
 * bundle, or to migrate a corpus between machines without re-embedding.
 *
 * Entries are written in the same formatter-ready shape `staticVectorStore`
 * serves, so the two paths render identically.
 *
 * @returns the number of entries written.
 */
export async function importCorpus(
  store: MemoryStore,
  bundle: CorpusBundle,
  identity?: MemoryIdentity,
): Promise<number> {
  if (!store) throw new Error('importCorpus: `store` is required.');
  assertCorpusBundle(bundle, 'importCorpus');
  assertServesVectors(store, 'importCorpus');

  // Default to the namespace the bundle was exported from. An explicit
  // identity re-homes the corpus (per-tenant seeding).
  const target: MemoryIdentity = identity ?? { conversationId: bundleConversationId(bundle) };
  const rows = bundle.entries.map((entry) => bundleEntryToMemoryEntry(entry, bundle));
  for (let i = 0; i < rows.length; i += 100) {
    await store.putMany(target, rows.slice(i, i + 100));
  }
  return rows.length;
}

/**
 * The `conversationId` that reproduces the bundle's namespace under the
 * default identity scheme (`identityNamespace({ conversationId: X })` ===
 * bundle.namespace for the default exports). Falls back to the namespace
 * string itself, which keeps import/export round-trips stable even for
 * exotic identities — pass an explicit `identity` to `importCorpus` when the
 * corpus was indexed under one.
 */
function bundleConversationId(bundle: CorpusBundle): string {
  const probe = identityNamespace(DEFAULT_CORPUS_IDENTITY);
  if (bundle.namespace === probe) {
    return DEFAULT_CORPUS_IDENTITY.conversationId;
  }
  return bundle.namespace;
}

/** First few ids, so a refusal is findable without being a wall. */
function sample(ids: readonly string[]): string {
  const shown = ids.slice(0, 5).join(', ');
  return ids.length > 5 ? `${shown}, and ${ids.length - 5} more` : shown;
}

/**
 * Everything the stored value carried EXCEPT the passage, flattened into one
 * metadata record: nested `metadata` first, then the value's own top-level
 * fields (`docUri`, `heading`, `page`, offsets, hashes — a `Chunk` keeps its
 * provenance at the top level). The provenance reader accepts either level,
 * and flattening keeps re-exports stable.
 */
function flattenMetadata(entry: MemoryEntry<unknown>): Record<string, unknown> | undefined {
  const value = entry.value;
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const nested =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  const out: Record<string, unknown> = { ...(nested ?? {}) };
  for (const [key, field] of Object.entries(record)) {
    if (key === 'content' || key === 'text' || key === 'metadata') continue;
    out[key] = field;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
