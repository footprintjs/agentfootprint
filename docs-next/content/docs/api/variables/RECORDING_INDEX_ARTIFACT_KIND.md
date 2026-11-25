---
title: RECORDING_INDEX_ARTIFACT_KIND
---

# Variable: RECORDING\_INDEX\_ARTIFACT\_KIND

> `const` **RECORDING\_INDEX\_ARTIFACT\_KIND**: `"recording/run-index"` = `'recording/run-index'`

Defined in: [src/artifacts/recordingArtifact.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/recordingArtifact.ts#L62)

The kind of a recording saved IN PARTS: the index that names every part.

A saved recording takes one of two layouts. The whole layout is one artifact
of kind [RECORDING\_ARTIFACT\_KIND](/docs/api/variables/RECORDING_ARTIFACT_KIND). The parts layout is one index of
this kind, one base part and a few invocation parts, all of kind
[RECORDING\_PART\_ARTIFACT\_KIND](/docs/api/variables/RECORDING_PART_ARTIFACT_KIND) and all in the same scope. The receipt
names the index. Its own kind keeps every reader that expects a whole
recording from reading an index as one. `openSavedRecording` (from
`agentfootprint/observe`) opens either layout.
