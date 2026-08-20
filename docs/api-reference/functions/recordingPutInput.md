[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / recordingPutInput

# Function: recordingPutInput()

> **recordingPutInput**(`recording`, `facts?`): [`PutArtifactInput`](/agentfootprint/api/generated/interfaces/PutArtifactInput.md)

Defined in: [src/artifacts/recordingArtifact.ts:91](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/recordingArtifact.ts#L91)

Turn one finished recording into the `put` input that stores it.

Pure: no store, no events, no agent. The caller owns WHEN this happens (after
the answer is composed) and what to do when it fails.

## Parameters

### recording

`unknown`

### facts?

[`RecordingMintFacts`](/agentfootprint/api/generated/interfaces/RecordingMintFacts.md) = `{}`

## Returns

[`PutArtifactInput`](/agentfootprint/api/generated/interfaces/PutArtifactInput.md)

## Throws

UnserializableRecordingError when the recording cannot be
  JSON-serialized — a cyclic object in a snapshot, most likely.
