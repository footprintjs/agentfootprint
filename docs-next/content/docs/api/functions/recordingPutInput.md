---
title: recordingPutInput
---

# Function: recordingPutInput()

> **recordingPutInput**(`recording`, `facts?`): [`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput)

Defined in: [src/artifacts/recordingArtifact.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L91)

Turn one finished recording into the `put` input that stores it.

Pure: no store, no events, no agent. The caller owns WHEN this happens (after
the answer is composed) and what to do when it fails.

## Parameters

### recording

`unknown`

### facts?

[`RecordingMintFacts`](/docs/api/interfaces/RecordingMintFacts) = `{}`

## Returns

[`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput)

## Throws

UnserializableRecordingError when the recording cannot be
  JSON-serialized — a cyclic object in a snapshot, most likely.
