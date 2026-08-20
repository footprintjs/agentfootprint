[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolArtifactPutInput

# Type Alias: ToolArtifactPutInput

> **ToolArtifactPutInput** = `Omit`\<[`PutArtifactInput`](/agentfootprint/api/generated/interfaces/PutArtifactInput.md), `"origin"`\>

Defined in: [src/artifacts/capability.ts:40](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/capability.ts#L40)

A tool's `put` — everything the caller owns EXCEPT `origin`, which the
 framework stamps from the run's own facts (never invented, never spoofed).
