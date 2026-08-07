/**
 * agentfootprint/rag — turning a folder of documents into something an agent
 * can retrieve from.
 *
 * Loaders (text, Markdown, HTML, PDF), splitters, and the indexing chart that
 * runs them: everything between "I have some documents" and "the vectors are
 * in a store".
 *
 * ── Why this is its own door ────────────────────────────────────────────────
 * Index time is a different PROCESS from run time. It happens at boot, on a
 * cron, or from a CLI; it touches the filesystem; and for PDFs it reaches for
 * an optional peer dependency. None of that belongs in the bundle of an agent
 * that only wants to answer a question — a browser or edge runtime importing
 * `agentfootprint` should never resolve `node:fs`. A door is the unit at which
 * a bundler can cut, and this is the cut.
 *
 * ── `defineRAG` is NOT here, deliberately ───────────────────────────────────
 * The retriever stays on the MAIN barrel, with `indexDocuments`, because it is
 * run-time wiring: it is registered on an agent, it runs on every turn, and it
 * belongs beside `defineTool` and the rest of the wiring surface. This door is
 * the other half of the story — the half that runs once, before any agent
 * exists.
 *
 *   import { defineRAG, indexDocuments } from 'agentfootprint';        // wiring
 *   import { sqliteVectorStore } from 'agentfootprint/memory';         // where it lives
 *   import { indexFolder, byHeading } from 'agentfootprint/rag';       // building it
 *
 * ── Deferred, with destinations named ───────────────────────────────────────
 * **Re-ranking and MMR** are retrieval-side concerns and belong behind
 * `RetrievalStrategy` (`agentfootprint/memory`), not here — a re-ranker is a
 * different rule for choosing among candidates, not a different way of
 * building an index. **File watching** is deliberately absent: `indexCorpus`
 * is an explicit call because magic that re-indexes behind you is magic that
 * re-bills you. Run it at boot, from a cron, or from the CLI.
 *
 * @example
 * ```ts
 * import { indexFolder } from 'agentfootprint/rag';
 * import { sqliteVectorStore } from 'agentfootprint/memory';
 * import { staticEmbedder } from 'agentfootprint/providers';
 *
 * const report = await indexFolder('./docs', {
 *   to: sqliteVectorStore({ file: './corpus.db' }),
 *   embedder: staticEmbedder(),
 * });
 * // { discovered: 3, loaded: 3, chunks: 14, embedded: 14, skipped: 0, removed: 0, … }
 * ```
 */

export * from '../rag/index.js';
