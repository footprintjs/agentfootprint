[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactEventFact

# Type Alias: ArtifactEventFact

> **ArtifactEventFact** = \{ `meta`: [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md); `type`: `"minted"`; \} \| \{ `bytes`: `number`; `kind`: `string`; `ref`: [`ArtifactRef`](/agentfootprint/api/generated/type-aliases/ArtifactRef.md); `type`: `"resolved"`; `via`: `"head"` \| `"get"`; \} \| \{ `swept`: [`SweptArtifact`](/agentfootprint/api/generated/interfaces/SweptArtifact.md); `type`: `"expired"`; \} \| \{ `detail?`: `string`; `op`: [`ArtifactOp`](/agentfootprint/api/generated/type-aliases/ArtifactOp.md); `reason`: [`ArtifactRefusalReason`](/agentfootprint/api/generated/type-aliases/ArtifactRefusalReason.md); `ref?`: [`ArtifactRef`](/agentfootprint/api/generated/type-aliases/ArtifactRef.md); `type`: `"refused"`; \}

Defined in: [src/artifacts/capability.ts:80](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/capability.ts#L80)

One thing that happened at this door — meta only, never payloads.
