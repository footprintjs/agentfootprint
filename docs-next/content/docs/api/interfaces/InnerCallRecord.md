---
title: InnerCallRecord
---

# Interface: InnerCallRecord

Defined in: src/core/runbook/dispatch.ts:27

One inner call, as the bridge recorded it.

## Properties

### outcome

> `readonly` **outcome**: `"ok"` \| `"absent"` \| `"error"`

Defined in: src/core/runbook/dispatch.ts:29

***

### result?

> `readonly` `optional` **result?**: `unknown`

Defined in: src/core/runbook/dispatch.ts:31

The raw returned value (`'ok'` and `'absent'` outcomes).

***

### tool

> `readonly` **tool**: `string`

Defined in: src/core/runbook/dispatch.ts:28
