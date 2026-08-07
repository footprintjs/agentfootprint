# rag/ — a folder of documents becomes an answering agent

Three steps, each usable on its own:

| step | what it does | file |
|---|---|---|
| **load** | bytes → text, keeping the positions the text came from | `loadDocuments.ts` |
| **split** | text → chunks that know where they came from | `splitDocuments.ts` |
| **index** | chunks → vectors in a store, as a footprintjs chart | `indexCorpus.ts` |

`indexFolder()` is the one-call version over all three. The CLI
(`agentfootprint-index`) is that call with argument parsing.

## The law this folder keeps

**A chunk must be able to say where it came from.** Not "which document,
roughly" — which document, which characters of it, which page, under which
heading:

```ts
doc.text.slice(chunk.charStart, chunk.charEnd) === chunk.text
```

`splitDocuments` verifies it and refuses a splitter that breaks it. Everything
else here follows from it: loaders normalise before offsets exist and never
after, the HTML stripper replaces tags with equal-length whitespace instead of
deleting them, and `trimSpan` moves offsets rather than trimming text.

## What is NOT here

- `defineRAG` — run-time wiring, main barrel.
- Re-ranking / MMR — retrieval-side, behind `RetrievalStrategy` in `memory/`.
- File watching — `indexCorpus` is an explicit call, by design.
