---
title: DatasetArtifactReceipt
---

# Type Alias: DatasetArtifactReceipt

> **DatasetArtifactReceipt** = \{ `meta`: [`ArtifactMeta`](/docs/api/interfaces/ArtifactMeta); `status`: `"stored"`; \} \| \{ `reason`: `"store-unavailable"` \| `"missing-or-expired"`; `status`: `"unavailable"`; \}

Defined in: [src/artifacts/datasetResult.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/datasetResult.ts#L18)

A failed write or a ticket no longer held is never advertised as a stored payload.
