**Support** — the vector machinery memory retrieval sits on: embed, measure, and
say when an input was too long to read.

## What it reads / what it writes
- Reads message text and a pluggable `Embedder`.
- Writes embeddings onto entries and an emit event per embedding call. It
  decides nothing about what is recalled — that is `../retrieval/`.

## The one law here
A truncation is an omission and must be reported: `inputCeiling.ts` owns how
long a text may be before the embedder stops reading it, and says when one was
longer.

## Files
- `embedMessages.ts`, `loadRelevant.ts` — the write- and read-side stages.
- `types.ts` — the `Embedder` seam; `mockEmbedder.ts` — deterministic tests.
- `cosine.ts` — the similarity metric `store.search()` uses.
- `inputCeiling.ts`, `emitEmbedding.ts`, `index.ts`.
