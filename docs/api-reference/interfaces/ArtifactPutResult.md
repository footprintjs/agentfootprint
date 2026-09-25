[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactPutResult

# Interface: ArtifactPutResult

Defined in: [src/artifacts/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L150)

What `put` hands back: the ticket, plus everything retention swept to admit
it. Sweeps ride the RESULT (collect during traversal, never post-process) so
the capability layer can put each one on the record as it happens — a store
that evicted silently would be a store that lies by omission.

## Properties

### meta

> `readonly` **meta**: [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md)

Defined in: [src/artifacts/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L151)

***

### swept

> `readonly` **swept**: readonly [`SweptArtifact`](/agentfootprint/api/generated/interfaces/SweptArtifact.md)[]

Defined in: [src/artifacts/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L152)
