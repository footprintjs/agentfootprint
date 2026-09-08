---
title: servedViews
---

# Function: servedViews()

> **servedViews**(`source`): [`ServedView`](/docs/api/interfaces/ServedView)[]

Defined in: src/lib/time-travel/servedView.ts:1055

Every epoch's served view, in run order — `servedAt` for a whole run, with
one pass over the recording instead of one per epoch.

## Parameters

### source

`unknown`

## Returns

[`ServedView`](/docs/api/interfaces/ServedView)[]

## Example

```ts
servedViews(agent.getSnapshot()!).map((v) => v.tools.names.length); // [3, 3, 0]
```
