[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / lexicalDriverScorer

# Variable: lexicalDriverScorer

> `const` **lexicalDriverScorer**: [`CheckInScorer`](/agentfootprint/api/generated/type-aliases/CheckInScorer.md)

Defined in: [src/core/checkin.ts:282](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/checkin.ts#L282)

The default drivers scorer: deterministic Jaccard token overlap between
the tool text and each context unit. Zero LLM, zero network, structuredClone
-safe output. Ties keep input order (stable sort).
