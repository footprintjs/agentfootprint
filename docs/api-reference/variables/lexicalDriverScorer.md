[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / lexicalDriverScorer

# Variable: lexicalDriverScorer

> `const` **lexicalDriverScorer**: [`CheckInScorer`](/agentfootprint/api/generated/type-aliases/CheckInScorer.md)

Defined in: [src/core/checkin.ts:282](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/checkin.ts#L282)

The default drivers scorer: deterministic Jaccard token overlap between
the tool text and each context unit. Zero LLM, zero network, structuredClone
-safe output. Ties keep input order (stable sort).
