[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolWants

# Type Alias: ToolWants

> **ToolWants** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/artifacts/wants.ts:33](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/artifacts/wants.ts#L33)

The declaration on a tool: argument name → the artifact `kind` that
argument must resolve to (consumer vocabulary, exact-match — no wildcards,
no hierarchy; `'dataset/rows'` is one kind, not a family).
