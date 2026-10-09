---
title: AgentRecordingsOptions
---

# Interface: AgentRecordingsOptions

Defined in: [src/core/agent/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L143)

The object form of [AgentArtifactsOptions.recordings](/docs/api/interfaces/AgentArtifactsOptions#recordings).

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/core/agent/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L152)

The label every minted recording carries, verbatim.

Absent, each is labelled `run <runId>`. A static label repeats across runs
on purpose — what distinguishes two recordings is the ref and
`origin.runId`, and a library that decorated your label to make it unique
would be overruling the name you chose.

***

### packed?

> `readonly` `optional` **packed?**: `boolean`

Defined in: [src/core/agent/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types.ts#L165)

Mint the recording PACKED: every value it holds in more than one place is
written once (`packRecording`, format `agentfootprint.recording.packed.v1`).
Default `false` — the plain `{ snapshot, events, structure }` text.

A plain recording repeats the conversation once per place that saw it, so
it grows with the square of the iteration count; measured with 1,000-row
tool results, 808 MB at 40 iterations, and past JSON's string limit before
80. Packed, the same runs are a few MB and grow linearly. A reader expands
it with `unpackRecording` (from `agentfootprint/observe`), which also reads
a plain recording unchanged — adopt the reader first, then pack.
