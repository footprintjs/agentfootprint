---
title: ToolPeriod
---

# Interface: ToolPeriod

Defined in: [src/core/agent/arguments/declare.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L126)

Which arguments set the period a tool's answer covers, how their values are
spelled, and the facts about the source. The one period shape's TOOL half;
the result half (`DeclaredPeriod`: what a read queried and what the store
holds) belongs to the result doors.

Two ways to name the shape, never both: today's single argument
(`argument` + `spelling`, or `accepts` for several spellings, and
`zoneArgument` beside a `wall-range`), which is sugar over the general
`forms` — every shape the tool accepts, in preference order.

## Example

```ts
period: { argument: 'window', spelling: 'lookback' }  // '2h', '24h', '7d'
period: {
  forms: [{ kind: 'bounds',
            from: { argument: 'start_time', as: 'epoch-ms' },
            to:   { argument: 'end_time',   as: 'epoch-ms', edge: 'exclusive' } }],
  direction: 'past', retention: '30d',
}
```

## Properties

### accepts?

> `readonly` `optional` **accepts?**: readonly [`PeriodSpelling`](/docs/api/type-aliases/PeriodSpelling)[]

Defined in: [src/core/agent/arguments/declare.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L131)

Every single-argument spelling the argument takes, in preference order.

***

### argument?

> `readonly` `optional` **argument?**: `string`

Defined in: [src/core/agent/arguments/declare.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L128)

***

### direction?

> `readonly` `optional` **direction?**: [`PeriodDirection`](/docs/api/type-aliases/PeriodDirection)

Defined in: [src/core/agent/arguments/declare.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L140)

Which side of now the source can hold; absent: not checked.

***

### filtersToAsked?

> `readonly` `optional` **filtersToAsked?**: `boolean`

Defined in: [src/core/agent/arguments/declare.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L148)

The tool reads `ctx.time.asked` and drops rows outside it.

***

### forms?

> `readonly` `optional` **forms?**: readonly [`PeriodForm`](/docs/api/type-aliases/PeriodForm)[]

Defined in: [src/core/agent/arguments/declare.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L135)

***

### granularity?

> `readonly` `optional` **granularity?**: `string`

Defined in: [src/core/agent/arguments/declare.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L146)

The source's smallest step (`1m`).

***

### maxRange?

> `readonly` `optional` **maxRange?**: `string`

Defined in: [src/core/agent/arguments/declare.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L144)

The widest window the tool accepts at once (`24h`).

***

### retention?

> `readonly` `optional` **retention?**: `string`

Defined in: [src/core/agent/arguments/declare.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L142)

The oldest data the source keeps (`30d`).

***

### spelling?

> `readonly` `optional` **spelling?**: [`PeriodSpelling`](/docs/api/type-aliases/PeriodSpelling)

Defined in: [src/core/agent/arguments/declare.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L129)

***

### wallZone?

> `readonly` `optional` **wallZone?**: `"app"`

Defined in: [src/core/agent/arguments/declare.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L137)

A `wall` / `date` / `day` form with no zone argument reads in the app's `.time({ zone })` — explicit, never implied.

***

### zoneArgument?

> `readonly` `optional` **zoneArgument?**: `string`

Defined in: [src/core/agent/arguments/declare.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/arguments/declare.ts#L133)

The argument that carries the zone of a `wall-range`.
