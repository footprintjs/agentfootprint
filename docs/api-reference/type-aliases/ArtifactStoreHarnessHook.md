[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ArtifactStoreHarnessHook

# Type Alias: ArtifactStoreHarnessHook

> **ArtifactStoreHarnessHook** = `"advanceTime"` \| `"corrupt"` \| `"boundedStore"`

Defined in: [src/artifacts/conformance/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/conformance/types.ts#L62)

Harness hooks a case cannot run without.

Each one is something no store can be asked to do through the port itself:
move its clock, damage its own bytes, or come into being with a different
budget. There is no portable way to do any of them, so they are the
harness's job — and a case that needs one nobody supplied FAILS rather than
skipping (see [ArtifactStoreOutcome](/agentfootprint/api/generated/type-aliases/ArtifactStoreOutcome.md)).
