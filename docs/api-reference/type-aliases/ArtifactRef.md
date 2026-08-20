[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactRef

# Type Alias: ArtifactRef

> **ArtifactRef** = `string`

Defined in: [src/artifacts/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/types.ts#L64)

The ref the model speaks — an opaque MINTED string (`art_` + 22 random
chars, ~26 total). Never content-addressed: the digest is metadata, never
the key (content-as-key would collide two tenants' identical bytes into one
object and could never name two generations of "the current dataset").
The grammar has ONE owner: `naming.ts`.
