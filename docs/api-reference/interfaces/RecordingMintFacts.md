[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RecordingMintFacts

# Interface: RecordingMintFacts

Defined in: [src/artifacts/recordingArtifact.ts:45](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/recordingArtifact.ts#L45)

What a recording mint needs to know beyond the recording itself.

## Properties

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/artifacts/recordingArtifact.ts:59](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/recordingArtifact.ts#L59)

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

Defined in: [src/artifacts/recordingArtifact.ts:48](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/artifacts/recordingArtifact.ts#L48)

The run this recording is OF — stamped on `origin.runId`, which is the
 join back to the trace.
