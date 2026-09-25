[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / withDatasetArtifacts

# Function: withDatasetArtifacts()

> **withDatasetArtifacts**\<`TArgs`, `TResult`, `TProjected`\>(`tool`, `adapter`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult` \| `TProjected`\>

Defined in: [src/artifacts/datasetResult.ts:55](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/datasetResult.ts#L55)

Adapt any local, HTTP-backed or MCP Tool using the SAME already-bound execution capability.
Claim-check: the host configures storage; the model carries tickets between tools. No UI required.
No store: pass through without calling the adapter; the host's normal result policy still applies.
Writes are independent, not a transaction. A failed source does not hide otherwise readable data;
its unavailable receipt must remain explicit in the producer's projection. Recheck tickets after
the batch because a later put can evict an earlier one. Expiry after publication remains possible.
This stages materialized payloads; it does not add remote handles, streaming or query pushdown.

## Type Parameters

### TArgs

`TArgs`

### TResult

`TResult`

### TProjected

`TProjected`

## Parameters

### tool

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult`\>

### adapter

[`DatasetResultAdapter`](/agentfootprint/api/generated/interfaces/DatasetResultAdapter.md)\<`TArgs`, `TResult`, `TProjected`\>

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult` \| `TProjected`\>
