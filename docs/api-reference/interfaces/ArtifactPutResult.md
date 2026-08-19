[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactPutResult

# Interface: ArtifactPutResult

Defined in: [src/artifacts/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L150)

What `put` hands back: the ticket, plus everything retention swept to admit
it. Sweeps ride the RESULT (collect during traversal, never post-process) so
the capability layer can put each one on the record as it happens — a store
that evicted silently would be a store that lies by omission.

## Properties

### meta

> `readonly` **meta**: [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md)

Defined in: [src/artifacts/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L151)

***

### swept

> `readonly` **swept**: readonly [`SweptArtifact`](/agentfootprint/api/generated/interfaces/SweptArtifact.md)[]

Defined in: [src/artifacts/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/types.ts#L152)
