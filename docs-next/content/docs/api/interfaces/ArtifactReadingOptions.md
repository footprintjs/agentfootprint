---
title: ArtifactReadingOptions
---

# Interface: ArtifactReadingOptions

Defined in: [src/tools/artifactReading.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactReading.ts#L17)

Mount a bounded stored-data reader; omitted means the existing catalog is unchanged.

## Properties

### admission

> `readonly` **admission**: [`SessionArtifactAdmissionOptions`](/docs/api/interfaces/SessionArtifactAdmissionOptions)

Defined in: [src/tools/artifactReading.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactReading.ts#L19)

Exact allowed kinds, payload ceiling and optional narrowing domain check.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/tools/artifactReading.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactReading.ts#L21)

Ordinary tool name; defaults to artifact_detail and is reserved only when enabled.
