[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArtifactPutInput

# Type Alias: ToolArtifactPutInput

> **ToolArtifactPutInput** = `Omit`\<[`PutArtifactInput`](/agentfootprint/api/generated/interfaces/PutArtifactInput.md), `"origin"`\>

Defined in: [src/artifacts/capability.ts:40](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/capability.ts#L40)

A tool's `put` — everything the caller owns EXCEPT `origin`, which the
 framework stamps from the run's own facts (never invented, never spoofed).
