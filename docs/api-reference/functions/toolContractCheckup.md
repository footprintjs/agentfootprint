[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / toolContractCheckup

# Function: toolContractCheckup()

> **toolContractCheckup**(`agentTools`, `serverCatalog`): [`ToolContractCheckup`](/agentfootprint/api/generated/interfaces/ToolContractCheckup.md)

Defined in: [src/core/toolContract.ts:70](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/toolContract.ts#L70)

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
