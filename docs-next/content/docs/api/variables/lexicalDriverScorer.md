---
title: lexicalDriverScorer
---

# Variable: lexicalDriverScorer

> `const` **lexicalDriverScorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L282)

The default drivers scorer: deterministic Jaccard token overlap between
the tool text and each context unit. Zero LLM, zero network, structuredClone
-safe output. Ties keep input order (stable sort).
