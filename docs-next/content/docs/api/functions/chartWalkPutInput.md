---
title: chartWalkPutInput
---

# Function: chartWalkPutInput()

> **chartWalkPutInput**(`rows`, `facts?`): [`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput)

Defined in: [src/artifacts/recordingArtifact.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L163)

Turn one chart walk into the `put` input that stores it under
[CHART\_WALK\_ARTIFACT\_KIND](/docs/api/variables/CHART_WALK_ARTIFACT_KIND).

Pure, and serialized to JSON TEXT at the mint for exactly the reasons the
run recording is (see the file header): a walk row must never be a live
view into engine memory, and a walk JSON cannot carry could not cross any
wire either.

## Parameters

### rows

readonly `unknown`[]

### facts?

`ChartWalkMintFacts` = `{}`

## Returns

[`PutArtifactInput`](/docs/api/interfaces/PutArtifactInput)

## Throws

UnserializableRecordingError when the rows cannot be
  JSON-serialized. Walk rows are projected to plain data upstream, so this
  firing means the projection let a live value through — fail at the mint,
  loudly.
