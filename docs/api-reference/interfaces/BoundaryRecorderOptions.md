[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BoundaryRecorderOptions

# Interface: BoundaryRecorderOptions

Defined in: [src/recorders/observability/BoundaryRecorder.ts:416](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L416)

## Properties

### getCommitCount?

> `readonly` `optional` **getCommitCount?**: () => `number`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:427](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L427)

Live commit-count accessor — typically `() => executor.getCommitCount()`
from footprintjs 5.1+. Inject from your runner. When provided:
  - Every DomainEvent gains `commitIdxBefore` / `commitIdxAfter`.
  - `recorder.boundaryIndex` is populated with open/close ranges
    keyed on each subflow's entry event.
When omitted (legacy / pre-5.1 footprintjs): both fields are 0 on
every event; `boundaryIndex` exists but is empty. Phase 5 Layer 2.

#### Returns

`number`

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:417](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/BoundaryRecorder.ts#L417)
