---
type: internal
---
**The retriever declaration left `src/lib/` for the RAG folder.** `src/lib/rag/` (`defineRAG`, which declares a read-only retriever over a named corpus, and `indexDocuments`) moved whole to `src/rag/retriever/`, with its tests from `test/lib/rag/` to `test/rag/retriever/`. Both folders were already at the same layer, so `npm run check:layering` reports the same edges, and `src/lib/` now holds only its leaves. The barrels are not merged: the main barrel exports the same names from the new path, and the `/rag` door's `src/rag/index.ts` is unchanged, so `/rag` gains no names. Internal paths only: every public door exports the same names.
