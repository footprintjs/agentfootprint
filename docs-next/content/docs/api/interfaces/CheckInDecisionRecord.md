---
title: CheckInDecisionRecord
---

# Interface: CheckInDecisionRecord

Defined in: src/recorders/core/CheckInRecorder.ts:55

One captured human decision.

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: src/recorders/core/CheckInRecorder.ts:59

***

### by

> `readonly` **by**: `string`

Defined in: src/recorders/core/CheckInRecorder.ts:60

***

### componentId?

> `readonly` `optional` **componentId?**: `string`

Defined in: src/recorders/core/CheckInRecorder.ts:64

The registered component that collected this decision (9.24.0), when the
 ask carried one — which SURFACE the person answered through.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/recorders/core/CheckInRecorder.ts:58

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: src/recorders/core/CheckInRecorder.ts:61

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: src/recorders/core/CheckInRecorder.ts:57

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/recorders/core/CheckInRecorder.ts:56
