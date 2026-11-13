---
title: CheckInDecisionRecord
---

# Interface: CheckInDecisionRecord

Defined in: [src/recorders/core/CheckInRecorder.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L55)

One captured human decision.

## Properties

### approved

> `readonly` **approved**: `boolean`

Defined in: [src/recorders/core/CheckInRecorder.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L61)

***

### by

> `readonly` **by**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L62)

***

### componentId?

> `readonly` `optional` **componentId?**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L71)

The registered component that collected this decision (9.24.0), when the
 ask carried one — which SURFACE the person answered through.

***

### hiddenArgs?

> `readonly` `optional` **hiddenArgs?**: readonly `string`[]

Defined in: [src/recorders/core/CheckInRecorder.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L68)

The arguments the tool's view hid from the person when they decided
 (`CheckInDecisionPayload.hiddenArgs`): this approval or decline was
 given without seeing those values. Names only. Absent when none were
 hidden.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/recorders/core/CheckInRecorder.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L58)

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L63)

***

### requestId

> `readonly` **requestId**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L60)

The request this decision answered (`CheckInRequest.id`).

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L57)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/recorders/core/CheckInRecorder.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/CheckInRecorder.ts#L56)
