[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toolContractCheckup

# Function: toolContractCheckup()

> **toolContractCheckup**(`agentTools`, `serverCatalog`): [`ToolContractCheckup`](/agentfootprint/api/generated/interfaces/ToolContractCheckup.md)

Defined in: [src/core/toolContract.ts:70](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core/toolContract.ts#L70)

Diff an agent's tools against a server's tool catalog. Pure + deterministic.

## Parameters

### agentTools

readonly ([`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| [`ServerToolEntry`](/agentfootprint/api/generated/interfaces/ServerToolEntry.md))[]

the agent's tools (`Tool[]` or `{name, inputSchema}[]`)

### serverCatalog

readonly [`ServerToolEntry`](/agentfootprint/api/generated/interfaces/ServerToolEntry.md)[]

the server's catalog (e.g. `await (await fetch('/tools')).json()`)

## Returns

[`ToolContractCheckup`](/agentfootprint/api/generated/interfaces/ToolContractCheckup.md)
