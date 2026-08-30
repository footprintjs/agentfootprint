---
title: RecordingMintFacts
---

# Interface: RecordingMintFacts

Defined in: [src/artifacts/recordingArtifact.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L54)

What a recording mint needs to know beyond the recording itself.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/recordingArtifact.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L77)

The operator's label, when they set one.

Used VERBATIM when present: an operator who named their recordings meant
that name, and a library that decorated it would be overruling them. The
consequence is worth stating — a static label repeats on every run, and
what distinguishes two recordings is the ref and `origin.runId`, never the
label. With no label the composed one names the run, which is the most
useful honest sentence available at mint time.

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/artifacts/recordingArtifact.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L57)

The run this recording is OF — stamped on `origin.runId`, which is the
 join back to the trace.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/artifacts/recordingArtifact.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L66)

The tool call this recording is OF, when a TOOL minted it (9.79.0) —
stamped on `origin.toolCallId`, the join back to the call that produced
it. Absent for an agent's own run recording, which is a whole turn and
belongs to no single call. The `chartWalkPutInput` law, verbatim: a walk
and the recording it projects are two views of ONE call, so they carry
the same join key or a consumer cannot pair them.
