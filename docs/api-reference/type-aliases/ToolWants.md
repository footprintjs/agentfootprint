[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolWants

# Type Alias: ToolWants

> **ToolWants** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/artifacts/wants.ts:33](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/wants.ts#L33)

The declaration on a tool: argument name → the artifact `kind` that
argument must resolve to (consumer vocabulary, exact-match — no wildcards,
no hierarchy; `'dataset/rows'` is one kind, not a family).
