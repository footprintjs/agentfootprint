[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactOp

# Type Alias: ArtifactOp

> **ArtifactOp** = `"put"` \| `"head"` \| `"get"` \| `"delete"` \| `"list"` \| `"dispatch"`

Defined in: [src/artifacts/capability.ts:66](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/capability.ts#L66)

Which door a refusal happened at — the five verbs, plus `'dispatch'`:
 the framework's own resolution of a tool's declared `wants` (and the
 `present` tool's argument checks) BEFORE execute. Not a sixth store verb
 — a dispatch refusal is the tool-calls stage declining to run a tool
 whose declared data could not be delivered.
