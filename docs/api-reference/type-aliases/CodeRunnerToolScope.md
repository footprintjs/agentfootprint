[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunnerToolScope

# Type Alias: CodeRunnerToolScope

> **CodeRunnerToolScope** = `Extract`\<[`TeardownScope`](/agentfootprint/api/generated/type-aliases/TeardownScope.md), `"call"` \| `"run"` \| `"session"`\>

Defined in: [src/core/codeRunnerTool.ts:63](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/codeRunnerTool.ts#L63)

The scopes a code session can be held under. `'shutdown'` is not one: it is
 when everything goes, not a thing to key a session on.
