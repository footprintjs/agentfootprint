[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / runArtifactStoreConformance

# Function: runArtifactStoreConformance()

> **runArtifactStoreConformance**(`harness`): `Promise`\<[`ArtifactStoreReport`](/agentfootprint/api/generated/interfaces/ArtifactStoreReport.md)\>

Defined in: [src/artifacts/conformance/run.ts:197](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/artifacts/conformance/run.ts#L197)

Run the whole battery against one store and report.

## Parameters

### harness

[`ArtifactStoreHarness`](/agentfootprint/api/generated/interfaces/ArtifactStoreHarness.md)

## Returns

`Promise`\<[`ArtifactStoreReport`](/agentfootprint/api/generated/interfaces/ArtifactStoreReport.md)\>

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
