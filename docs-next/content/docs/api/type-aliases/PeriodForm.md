---
title: PeriodForm
---

# Type Alias: PeriodForm

> **PeriodForm** = \{ `from`: [`Bound`](/docs/api/interfaces/Bound); `kind`: `"bounds"`; `to`: `ToBound`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge?`: `Edge`; `joiner`: `".."` \| `"/"`; `kind`: `"joined"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge`: `Edge`; `keys`: \{ `from`: `string`; `to`: `string`; \}; `kind`: `"object"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `kind`: `"day"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `kind`: `"lookback"`; `signed`: `boolean`; `units?`: `string`; \}

Defined in: [src/core/time/convert.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/convert.ts#L145)

Every shape a tool's period can take — one `TimeRange` onto one or more arguments.

## Union Members

### Type Literal

\{ `from`: [`Bound`](/docs/api/interfaces/Bound); `kind`: `"bounds"`; `to`: `ToBound`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge?`: `Edge`; `joiner`: `".."` \| `"/"`; `kind`: `"joined"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge`: `Edge`; `keys`: \{ `from`: `string`; `to`: `string`; \}; `kind`: `"object"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

#### argument

> `readonly` **argument**: `string`

#### as

> `readonly` **as**: [`BoundAs`](/docs/api/type-aliases/BoundAs)

#### edge

> `readonly` **edge**: `Edge`

Declared, never defaulted (TQ18).

#### keys

> `readonly` **keys**: `object`

##### keys.from

> `readonly` **from**: `string`

##### keys.to

> `readonly` **to**: `string`

#### kind

> `readonly` **kind**: `"object"`

#### zone?

> `readonly` `optional` **zone?**: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument)

***

### Type Literal

\{ `argument`: `string`; `kind`: `"day"`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `kind`: `"lookback"`; `signed`: `boolean`; `units?`: `string`; \}

#### argument

> `readonly` **argument**: `string`

#### kind

> `readonly` **kind**: `"lookback"`

#### signed

> `readonly` **signed**: `boolean`

#### units?

> `readonly` `optional` **units?**: `string`

A unit set ⊆ `smhdw`; absent → today's `mhdw`.
