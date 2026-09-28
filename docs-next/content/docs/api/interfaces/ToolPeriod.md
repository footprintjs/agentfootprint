---
title: ToolPeriod
---

# Interface: ToolPeriod

Defined in: [src/core/agent/arguments/declare.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L84)

Which argument sets the period a tool's answer covers, and how its values
are spelled. The one period shape's TOOL half; the result half
(`DeclaredPeriod`: what a read queried and what the store holds) belongs to
the result doors.

## Example

```ts
period: { argument: 'window', spelling: 'lookback' }  // '2h', '24h', '7d'
```

## Properties

### argument

> `readonly` **argument**: `string`

Defined in: [src/core/agent/arguments/declare.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L85)

***

### spelling?

> `readonly` `optional` **spelling?**: `PeriodSpelling`

Defined in: [src/core/agent/arguments/declare.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L86)
