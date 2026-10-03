---
title: normaliseInstants
---

# Function: normaliseInstants()

> **normaliseInstants**(`rows`, `axis`, `options?`): [`NormalisedAxis`](/docs/api/type-aliases/NormalisedAxis)

Defined in: src/core/time/axis.ts:588

THE READ-SIDE VIEW of a declared time column: every value turned into a UTC
`Z` instant at one precision, sorted in time, with every value it could not
place counted by reason (the module table). The rows are only read — never
copied into, reordered or rewritten — so the stored bytes are unchanged.

A malformed `axis` throws a `TypeError` naming its issues (read a ticket
with `readTimeAxis` first; a declaration is never repaired).

## Parameters

### rows

readonly `unknown`[]

### axis

[`DatasetTimeAxis`](/docs/api/interfaces/DatasetTimeAxis)

### options?

[`NormaliseOptions`](/docs/api/interfaces/NormaliseOptions) = `{}`

## Returns

[`NormalisedAxis`](/docs/api/type-aliases/NormalisedAxis)
