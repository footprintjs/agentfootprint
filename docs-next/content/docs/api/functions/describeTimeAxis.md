---
title: describeTimeAxis
---

# Function: describeTimeAxis()

> **describeTimeAxis**(`axis`): `string` \| `undefined`

Defined in: src/artifacts/timeAxis.ts:260

The declared SUMMARY in words, for a chart title — the one wording every
consumer shares, so two screens never describe one ticket two ways.

  `{ interval: '1h', aggregate: { a: 'avg', b: 'max' } }` → `'hourly avg and max'`
  `{ interval: '5m', aggregate: 'max' }`                 → `'5-minute max'`
  `{ interval: '5m', aggregate: 'raw' }`                 → `'raw samples every 5 minutes'`
  `{ aggregate: 'raw' }`                                 → `'raw samples'`

`undefined` when the declaration says nothing about summarising (column and
unit only) — there is no summary to put in a title, and inventing "raw"
would claim something the producer did not.

## Parameters

### axis

[`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis)

## Returns

`string` \| `undefined`
