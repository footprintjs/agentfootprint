[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DatasetArtifactReceipt

# Type Alias: DatasetArtifactReceipt

> **DatasetArtifactReceipt** = \{ `meta`: [`ArtifactMeta`](/agentfootprint/api/generated/interfaces/ArtifactMeta.md); `status`: `"stored"`; \} \| \{ `reason`: `"store-unavailable"` \| `"missing-or-expired"`; `status`: `"unavailable"`; \}

Defined in: [src/artifacts/datasetResult.ts:18](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L18)

A failed write or a ticket no longer held is never advertised as a stored payload.
