[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DatasetArtifactReceipt

# Type Alias: DatasetArtifactReceipt

> **DatasetArtifactReceipt** = \{ `meta`: [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md); `status`: `"stored"`; \} \| \{ `reason`: `"store-unavailable"` \| `"missing-or-expired"`; `status`: `"unavailable"`; \}

Defined in: [src/artifacts/datasetResult.ts:18](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/datasetResult.ts#L18)

A failed write or a ticket no longer held is never advertised as a stored payload.
