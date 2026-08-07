[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toolContractCheckup

# Function: toolContractCheckup()

> **toolContractCheckup**(`agentTools`, `serverCatalog`): [`ToolContractCheckup`](/agentfootprint/api/generated/interfaces/ToolContractCheckup.md)

Defined in: [src/core/toolContract.ts:70](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/toolContract.ts#L70)

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
