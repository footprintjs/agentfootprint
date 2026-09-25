[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactListResult

# Interface: ArtifactListResult

Defined in: [src/artifacts/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L170)

One page of tickets. Bytes never ride a listing.

## Properties

### artifacts

> `readonly` **artifacts**: readonly [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md)[]

Defined in: [src/artifacts/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L171)

***

### cursor?

> `readonly` `optional` **cursor?**: `string`

Defined in: [src/artifacts/types.ts:173](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/types.ts#L173)

Present iff more pages exist.
