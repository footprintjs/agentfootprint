**Support** — a build-time pipeline (load, split, index) governed by one law: a
chunk must be able to say which document and which characters it came from,
verified rather than assumed. Nothing here runs during a walk or composes a
sentence. (This folder only: `retriever/` below has its own README and its own
role.)

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

## `retriever/` — the run-time half, not on this door

`defineRAG` (declares a read-only retriever over a named corpus) and
`indexDocuments` (seeds a store from documents already in memory) live in
`retriever/`, with its own README and role. They are run-time wiring, exported
by the MAIN barrel; `index.ts` here does not re-export them, so the `/rag` door
stays the half that runs once, before any agent exists. `indexCorpus` and
`exportCorpus` read `retriever/defineRAG.ts` · `DEFAULT_CORPUS_IDENTITY` so a
corpus is indexed and served under one identity.

## What is NOT here

- Re-ranking / MMR — retrieval-side, behind `RetrievalStrategy` in `memory/`.
- File watching — `indexCorpus` is an explicit call, by design.
