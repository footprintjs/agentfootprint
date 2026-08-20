[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / runArtifactStoreCase

# Function: runArtifactStoreCase()

> **runArtifactStoreCase**(`testCase`, `harness`): `Promise`\<[`ArtifactStoreOutcome`](/agentfootprint/api/generated/type-aliases/ArtifactStoreOutcome.md)\>

Defined in: [src/artifacts/conformance/run.ts:119](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/conformance/run.ts#L119)

Run ONE case against one store, building and disposing the store around it.

Exported because a test framework wants one assertion per case: iterate
[artifactStoreConformance](/agentfootprint/api/generated/variables/artifactStoreConformance.md), call this, and turn the outcome into an
`it()`. That gives per-case granularity in any framework without this module
knowing what a framework is.

## Parameters

### testCase

[`ArtifactStoreCase`](/agentfootprint/api/generated/interfaces/ArtifactStoreCase.md)

### harness

[`ArtifactStoreHarness`](/agentfootprint/api/generated/interfaces/ArtifactStoreHarness.md)

## Returns

`Promise`\<[`ArtifactStoreOutcome`](/agentfootprint/api/generated/type-aliases/ArtifactStoreOutcome.md)\>
