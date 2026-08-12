[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CodeRunnerToolScope

# Type Alias: CodeRunnerToolScope

> **CodeRunnerToolScope** = `Extract`\<[`TeardownScope`](/agentfootprint/api/generated/type-aliases/TeardownScope.md), `"call"` \| `"run"` \| `"session"`\>

Defined in: [src/core/codeRunnerTool.ts:63](https://github.com/footprintjs/agentfootprint/blob/da6095f057eb2f2b7ab8d6ad464a4cbde8688032/src/core/codeRunnerTool.ts#L63)

The scopes a code session can be held under. `'shutdown'` is not one: it is
 when everything goes, not a thing to key a session on.
