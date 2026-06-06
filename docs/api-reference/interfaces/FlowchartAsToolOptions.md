[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartAsToolOptions

# Interface: FlowchartAsToolOptions

Defined in: [src/core/flowchartAsTool.ts:124](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L124)

Options for `flowchartAsTool`.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/core/flowchartAsTool.ts:128](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L128)

Tool description shown to the LLM.

***

### flowchart

> `readonly` **flowchart**: `FlowChart`

Defined in: [src/core/flowchartAsTool.ts:138](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L138)

The footprintjs flowchart to mount as the tool's body.
The chart's stages receive args via `scope.$getArgs()`.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:133](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L133)

JSON Schema describing the input args the LLM must produce.
Becomes `flowchart.run({ input: args })`. Default: `{ type: 'object', properties: {} }`.

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/flowchartAsTool.ts:126](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L126)

Tool name the LLM dispatches by. Must be unique across the agent's tools.

***

### resultMapper?

> `readonly` `optional` **resultMapper?**: [`FlowchartResultMapper`](/agentfootprint/api/generated/type-aliases/FlowchartResultMapper.md)

Defined in: [src/core/flowchartAsTool.ts:143](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L143)

Optional shaping function. Default: `JSON.stringify(snapshot.values)`.
Errors throw into the tool's `[mapper-error: ...]` envelope.
