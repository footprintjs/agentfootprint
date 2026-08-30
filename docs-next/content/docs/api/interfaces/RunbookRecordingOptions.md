---
title: RunbookRecordingOptions
---

# Interface: RunbookRecordingOptions

Defined in: [src/core/runbook/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L134)

The object form of [RunbookWalkOptions.recording](/docs/api/interfaces/RunbookWalkOptions#recording).

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/runbook/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L143)

The label the minted recording carries, verbatim.

Absent, it is `<toolName> recording`. A static label repeats across calls
on purpose — what distinguishes two recordings is the ref and
`origin.toolCallId`, and a library that decorated the name you chose to
make it unique would be overruling you (the `recordingPutInput` law).

***

### maxBytes?

> `readonly` `optional` **maxBytes?**: `number`

Defined in: [src/core/runbook/types.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L156)

The size ceiling, in bytes of the serialized recording. Default
`DEFAULT_RECORDING_MAX_BYTES` (5,000,000).

Over it, the recording is NOT filed and `recording_note` says so with both
numbers and this option's name. It is a refusal rather than a truncation
on purpose: the walk can be projected because rows are independently
meaningful, but `{ snapshot, events, structure }` is not row-shaped —
half a commit log under a whole chart is a recording that draws a picture
nobody can check, which is worse than a stated absence. A fleet sweep that
genuinely needs the whole thing raises this number, deliberately.
