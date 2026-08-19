---
title: ArtifactPutResult
---

# Interface: ArtifactPutResult

Defined in: [src/artifacts/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L150)

What `put` hands back: the ticket, plus everything retention swept to admit
it. Sweeps ride the RESULT (collect during traversal, never post-process) so
the capability layer can put each one on the record as it happens — a store
that evicted silently would be a store that lies by omission.

## Properties

### meta

> `readonly` **meta**: [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta)

Defined in: [src/artifacts/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L151)

***

### swept

> `readonly` **swept**: readonly [`SweptArtifact`](/docs/api/interfaces/SweptArtifact)[]

Defined in: [src/artifacts/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/types.ts#L152)
