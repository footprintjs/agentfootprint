---
title: FoldBasis
---

# Type Alias: FoldBasis

> **FoldBasis** = `"initial+log"` \| `"log-only"`

Defined in: src/lib/time-travel/keyedFold.ts:65

How a fold was derived — footprintjs's own two answers, restated here so a
caller of this module does not have to import the engine's trace barrel to
name them.

- `'initial+log'` — the recording carried its fold base, so a value seeded
  before the run (or before a resume) folds correctly.
- `'log-only'` — it did not. Anything the log never `set` reads as absent,
  and a reader must say so rather than present the hole as a proof.
