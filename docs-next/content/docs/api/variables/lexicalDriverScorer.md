---
title: lexicalDriverScorer
---

# Variable: lexicalDriverScorer

> `const` **lexicalDriverScorer**: [`CheckInScorer`](/docs/api/type-aliases/CheckInScorer)

Defined in: [src/core/checkin.ts:439](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L439)

The default drivers scorer: deterministic Jaccard token overlap between
the tool text and each context unit. Zero LLM, zero network, structuredClone
-safe output. Ties keep input order (stable sort).
