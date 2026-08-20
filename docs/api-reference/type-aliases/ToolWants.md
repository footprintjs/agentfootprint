[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolWants

# Type Alias: ToolWants

> **ToolWants** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/artifacts/wants.ts:33](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/wants.ts#L33)

The declaration on a tool: argument name → the artifact `kind` that
argument must resolve to (consumer vocabulary, exact-match — no wildcards,
no hierarchy; `'dataset/rows'` is one kind, not a family).
