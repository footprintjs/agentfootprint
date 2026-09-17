---
title: ArtifactEventFact
---

# Type Alias: ArtifactEventFact

> **ArtifactEventFact** = \{ `meta`: [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta); `type`: `"minted"`; \} \| \{ `bytes`: `number`; `kind`: `string`; `ref`: [`ArtifactRef`](/docs/api/type-aliases/ArtifactRef); `type`: `"resolved"`; `via`: `"head"` \| `"get"`; \} \| \{ `swept`: [`SweptArtifact`](/docs/api/interfaces/SweptArtifact); `type`: `"expired"`; \} \| \{ `detail?`: `string`; `op`: [`ArtifactOp`](/docs/api/type-aliases/ArtifactOp); `reason`: [`ArtifactRefusalReason`](/docs/api/type-aliases/ArtifactRefusalReason); `ref?`: [`ArtifactRef`](/docs/api/type-aliases/ArtifactRef); `type`: `"refused"`; \}

Defined in: [src/artifacts/capability.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/capability.ts#L80)

One thing that happened at this door — meta only, never payloads.
