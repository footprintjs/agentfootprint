---
title: defineTool
---

# Function: defineTool()

> **defineTool**\<`TArgs`, `TResult`\>(`options`): [`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

Defined in: [src/tools/tools.ts:1150](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/tools.ts#L1150)

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

[`DefineToolOptions`](/docs/api/interfaces/DefineToolOptions)\<`TArgs`, `TResult`\>

## Returns

[`Tool`](/docs/api/interfaces/Tool)\<`TArgs`, `TResult`\>

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
