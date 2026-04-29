[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / defineTool

# Function: defineTool()

> **defineTool**\<`TArgs`, `TResult`\>(`options`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult`\>

Defined in: [agentfootprint/src/core/tools.ts:78](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/tools.ts#L78)

Ergonomic builder for `Tool`. Equivalent to constructing an object
literal with `schema` + `execute`, but flatter and safer — the name
+ description live alongside the executor so they can't drift.

## Type Parameters

### TArgs

`TArgs` = `Record`\<`string`, `unknown`\>

### TResult

`TResult` = `unknown`

## Parameters

### options

[`DefineToolOptions`](/agentfootprint/api/generated/interfaces/DefineToolOptions.md)\<`TArgs`, `TResult`\>

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)\<`TArgs`, `TResult`\>

## Example

```ts
const weather = defineTool<{ city: string }, string>({
    name: 'weather',
    description: 'Get current weather for a city',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
    execute: async ({ city }) => `${city}: 72°F sunny`,
  });

  const agent = Agent.create({ provider }).tool(weather).build();
```
