---
title: runArtifactStoreConformance
---

# Function: runArtifactStoreConformance()

> **runArtifactStoreConformance**(`harness`): `Promise`\<[`ArtifactStoreReport`](/docs/api/interfaces/ArtifactStoreReport)\>

Defined in: [src/artifacts/conformance/run.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/conformance/run.ts#L197)

Run the whole battery against one store and report.

## Parameters

### harness

[`ArtifactStoreHarness`](/docs/api/interfaces/ArtifactStoreHarness)

## Returns

`Promise`\<[`ArtifactStoreReport`](/docs/api/interfaces/ArtifactStoreReport)\>

## Example

```ts
Claiming the port for a store of your own
  const report = await runArtifactStoreConformance({
    name: 'ourOwnArtifacts',
    createStore: () => ourOwnArtifacts({ bucket }),
    disposeStore: (store) => store.close(),
  });
  if (!report.ok) throw new Error(formatArtifactStoreReport(report));
```
