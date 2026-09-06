**Mixed** — a declared corpus, and the form its passages take when they are
served into a call.
Map: `defineRAG` declares a read-only retriever over a NAMED corpus — an
`Injection`, i.e. a declaration of when content should land.
Lens: the same module renders retrieved chunks as citable `<source>` blocks into
the system-prompt slot.

## What it reads / what it writes
- Reads the question and the store's top-K answer.
- Writes retrieved passages into the system-prompt slot, each citable back to
  its chunk.

## The one law here
Top-K is an ATTENTION omission and must be visible: the block says what it is
and what it is bounded by, and never implies the corpus holds nothing else.
Read-only since 8.8.0, because a re-embedded question scored 1.0 against itself
and ate a real passage's slot.

## Files
- `defineRAG.ts` — the declaration and the served block.
- `indexDocuments.ts` — seed a vector-capable store.
- `index.ts` — the door.
