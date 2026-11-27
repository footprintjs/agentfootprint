---
title: readInvocationModelInput
---

# Function: readInvocationModelInput()

> **readInvocationModelInput**(`recording`, `position`, `options?`): `Promise`\<[`RecordedModelInput`](/docs/api/type-aliases/RecordedModelInput)\>

Defined in: [src/time-travel/servedInvocation.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L168)

Read model input and its original receipt for one exact native child commit.
The caller supplies an already authorized recording opened by
`openSavedRecording`. A projected display axis must resolve the original
commit position before requesting it. No other branch can satisfy the read.

## Parameters

### recording

`SavedRecording`

### position

[`RecordedModelCall`](/docs/api/interfaces/RecordedModelCall)

### options?

`SavedRecordingReadOptions` = `{}`

## Returns

`Promise`\<[`RecordedModelInput`](/docs/api/type-aliases/RecordedModelInput)\>
