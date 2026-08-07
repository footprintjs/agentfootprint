---
name: A folder of documents becomes an answering agent
group: rag
guide: ../../src/rag/README.md
defaultInput: How long do refunds take?
---

# Folder → index → agent, with the provenance kept

Three real documents sit next to this example: two Markdown files and a
two-page PDF. The example indexes them, runs the index twice more to show what
an incremental re-index actually costs, and then answers a question from them.

```
run 1  (first index)   discovered 3 · loaded 3 · chunks 8 · embedded 8 · skipped 0 · removed 0
run 2  (no changes)    discovered 3 · loaded 3 · chunks 8 · embedded 0 · skipped 8 · removed 0
run 3  (edit + delete) discovered 2 · loaded 2 · chunks 5 · embedded 1 · skipped 4 · removed 3
```

**Run 2 is the point.** Nothing changed, so nothing was embedded. With an
`InMemoryStore` that saving lasts until the process exits; point `to` at
`sqliteVectorStore({ file })` and it lasts forever.

**Run 3 is the other point.** One document was edited and one was deleted. Only
the section that actually changed is re-embedded, and the deleted document's
chunks are removed — an index that still answered from `pricing.md` after you
deleted it would be worse than one that could not answer at all.

## Then the agent answers, and the passages can be found

```
why this passage
  ✓ refund-policy.md#1           0.87  refund-policy.md, Refund timing
  ✓ refund-policy.md#3           0.86  refund-policy.md, Partial refunds
  ✓ refund-policy.md#2           0.86  refund-policy.md, Eligibility
  ✗ refund-policy.md#0           0.86  refund-policy.md, Refund policy  over-max-entries
  ✗ security-overview.pdf#0      0.82  security-overview.pdf, p1  over-max-entries

answer: Refunds are processed within 5 business days.
```

Every line is a fact the run recorded, not a reconstruction: the chunk id, the
document it came from, the heading (Markdown) or page (PDF) it sits under, the
similarity score, and — for the ones that did not make it — which rule refused
them.

Note `security-overview.pdf#0  p1`. The page number is real, because the PDF
loader keeps text per page rather than flattening the document first. A
citation you can check by opening page 1.

## What to change first

- **`threshold: -1`** is here because `mockEmbedder` is a character-frequency
  hash and scores everything close together. With `staticEmbedder()` (no key,
  no network) use `0.5` and the rejections become meaningful.
- **`to: new InMemoryStore()`** → `sqliteVectorStore({ file: './corpus.db' })`
  and run 2's "embedded 0" survives a restart.

## From the command line

The same thing without writing a script:

```bash
npx agentfootprint-index ./examples/rag/docs --to ./corpus.db --embedder static
```
