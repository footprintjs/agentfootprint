---
title: PeriodForm
---

# Type Alias: PeriodForm

> **PeriodForm** = \{ `from`: [`Bound`](/docs/api/interfaces/Bound); `kind`: `"bounds"`; `maxRange?`: `DurationText`; `to`: `ToBound`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge?`: `Edge`; `joiner`: `".."` \| `"/"`; `kind`: `"joined"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge`: `Edge`; `keys`: \{ `from`: `string`; `to`: `string`; \}; `kind`: `"object"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `kind`: `"day"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \} \| \{ `argument`: `string`; `kind`: `"lookback"`; `maxRange?`: `DurationText`; `signed`: `boolean`; `units?`: `string`; \}

Defined in: [src/core/time/periodForm.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/periodForm.ts#L91)

Every shape a tool's period can take — one `TimeRange` onto one or more
arguments. Any form may carry its own `maxRange` — the widest window THAT
form reads at once — when the tool's forms differ (bounds capped at a day,
a look-back with no cap): it overrides the period's `maxRange` for that
form only (formMaxRange, the one owner).

## Union Members

### Type Literal

\{ `from`: [`Bound`](/docs/api/interfaces/Bound); `kind`: `"bounds"`; `maxRange?`: `DurationText`; `to`: `ToBound`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge?`: `Edge`; `joiner`: `".."` \| `"/"`; `kind`: `"joined"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `as`: [`BoundAs`](/docs/api/type-aliases/BoundAs); `edge`: `Edge`; `keys`: \{ `from`: `string`; `to`: `string`; \}; `kind`: `"object"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

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

#### maxRange?

> `readonly` `optional` **maxRange?**: `DurationText`

#### zone?

> `readonly` `optional` **zone?**: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument)

***

### Type Literal

\{ `argument`: `string`; `kind`: `"day"`; `maxRange?`: `DurationText`; `zone?`: [`ZoneArgument`](/docs/api/interfaces/ZoneArgument); \}

***

### Type Literal

\{ `argument`: `string`; `kind`: `"lookback"`; `maxRange?`: `DurationText`; `signed`: `boolean`; `units?`: `string`; \}

#### argument

> `readonly` **argument**: `string`

#### kind

> `readonly` **kind**: `"lookback"`

#### maxRange?

> `readonly` `optional` **maxRange?**: `DurationText`

#### signed

> `readonly` **signed**: `boolean`

#### units?

> `readonly` `optional` **units?**: `string`

A unit set ⊆ `smhdw`; absent → today's `mhdw`.
