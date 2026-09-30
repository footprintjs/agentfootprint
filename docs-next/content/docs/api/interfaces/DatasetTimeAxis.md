---
title: DatasetTimeAxis
---

# Interface: DatasetTimeAxis

Defined in: [src/artifacts/timeAxis.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L65)

A dataset's declared time axis.

## Examples

```ts
hourly buckets, two measures summarised differently
  { column: 'hour', unit: 'iso', interval: '1h',
    aggregate: { read_iops: 'avg', peak_iops: 'max' } }
```

```ts
raw samples every five minutes, epoch seconds
  { column: 'ts', unit: 'epoch-s', interval: '5m', aggregate: 'raw' }
```

## Properties

### aggregate?

> `readonly` `optional` **aggregate?**: [`TimeAxisAggregate`](/docs/api/type-aliases/TimeAxisAggregate) \| `"raw"` \| `Readonly`\<`Record`\<`string`, [`TimeAxisAggregate`](/docs/api/type-aliases/TimeAxisAggregate)\>\>

Defined in: [src/artifacts/timeAxis.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L89)

How each row summarises its interval. `'raw'` — every row is a sample as
collected, nothing was reduced. One aggregate — every measure column was
reduced the same way. A record — measure column to its own aggregate
(`{ avg_iops: 'avg', peak_iops: 'max' }`); a column not named there is
not a declared measure. Any aggregate other than `'raw'` requires
`interval`, and `interval` requires `aggregate`: a summary of an interval
nobody named, or an interval with no word for what happened in it, is
half a declaration.

***

### column

> `readonly` **column**: `string`

Defined in: [src/artifacts/timeAxis.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L67)

The column that holds time.

***

### interval?

> `readonly` `optional` **interval?**: `string`

Defined in: [src/artifacts/timeAxis.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L78)

Width of the interval one row stands for: a positive integer and one of
 `s m h d w` (`'30s'`, `'5m'`, `'1h'`, `'1d'`, `'1w'`). With
 `aggregate: 'raw'` it is the sampling cadence.

***

### unit

> `readonly` **unit**: [`TimeAxisUnit`](/docs/api/type-aliases/TimeAxisUnit)

Defined in: [src/artifacts/timeAxis.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L70)

`'iso'` — ISO-8601 strings; `'epoch-s'` / `'epoch-ms'` — numbers since
 1970-01-01T00:00:00Z in seconds / milliseconds.

***

### zone?

> `readonly` `optional` **zone?**: `string`

Defined in: [src/artifacts/timeAxis.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/timeAxis.ts#L74)

IANA zone (`'Europe/London'`) the values are WALL-CLOCK in. `'iso'`
 only — an epoch is an instant and has no zone to declare. Absent: the
 ISO strings carry their own offset (or are UTC).
