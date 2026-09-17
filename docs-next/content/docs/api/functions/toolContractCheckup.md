---
title: toolContractCheckup
---

# Function: toolContractCheckup()

> **toolContractCheckup**(`agentTools`, `serverCatalog`): [`ToolContractCheckup`](/docs/api/interfaces/ToolContractCheckup)

Defined in: [src/core/toolContract.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/toolContract.ts#L70)

Diff an agent's tools against a server's tool catalog. Pure + deterministic.

## Parameters

### agentTools

readonly ([`Tool`](/docs/api/interfaces/Tool)\<`Record`\<`string`, `unknown`\>, `unknown`\> \| [`ServerToolEntry`](/docs/api/interfaces/ServerToolEntry))[]

the agent's tools (`Tool[]` or `{name, inputSchema}[]`)

### serverCatalog

readonly [`ServerToolEntry`](/docs/api/interfaces/ServerToolEntry)[]

the server's catalog (e.g. `await (await fetch('/tools')).json()`)

## Returns

[`ToolContractCheckup`](/docs/api/interfaces/ToolContractCheckup)
