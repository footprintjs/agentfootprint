---
title: withDatasetArtifacts
---

# Function: withDatasetArtifacts()

> **withDatasetArtifacts**\<`TArgs`, `TResult`, `TProjected`\>(`tool`, `adapter`): [`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult` \| `TProjected`\>

Defined in: [src/artifacts/datasetResult.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/datasetResult.ts#L55)

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

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

### adapter

[`DatasetResultAdapter`](/docs/api/interfaces/DatasetResultAdapter)\<`TArgs`, `TResult`, `TProjected`\>

## Returns

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult` \| `TProjected`\>
