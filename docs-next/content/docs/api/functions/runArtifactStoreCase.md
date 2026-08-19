---
title: runArtifactStoreCase
---

# Function: runArtifactStoreCase()

> **runArtifactStoreCase**(`testCase`, `harness`): `Promise`\<[`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)\>

Defined in: [src/artifacts/conformance/run.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/run.ts#L119)

Run ONE case against one store, building and disposing the store around it.

Exported because a test framework wants one assertion per case: iterate
[artifactStoreConformance](/docs/api/variables/artifactStoreConformance), call this, and turn the outcome into an
`it()`. That gives per-case granularity in any framework without this module
knowing what a framework is.

## Parameters

### testCase

[`ArtifactStoreCase`](/docs/api/interfaces/ArtifactStoreCase)

### harness

[`ArtifactStoreHarness`](/docs/api/interfaces/ArtifactStoreHarness)

## Returns

`Promise`\<[`ArtifactStoreOutcome`](/docs/api/type-aliases/ArtifactStoreOutcome)\>
