**Fold** — what may be recalled now: top-k selection over scored candidates.

## What it reads / what it writes
- Reads the store's scored candidates.
- Writes the retrieval record. `provenance.ts` keeps each admitted chunk's exact
  prompt fragment, so the record resolves ONE injection per chunk instead of one
  per recall.

## The one law here
Top-k is an attention omission: what was considered is recorded, so a reader can
always see that the recall was bounded and by what.

## Files
- `topK.ts` — the strategy this library has always used, now written down.
- `provenance.ts` — read a stored entry's coordinates back out of it.
- `types.ts` — the record and the seam; `index.ts`.
