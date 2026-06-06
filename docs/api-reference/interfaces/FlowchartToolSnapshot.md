[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartToolSnapshot

# Interface: FlowchartToolSnapshot

Defined in: [src/core/flowchartAsTool.ts:95](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/flowchartAsTool.ts#L95)

Pruned snapshot view passed to `resultMapper`. We keep this minimal
(the values bag + the chart's narrative entries) to avoid leaking
internal scope plumbing. Consumers needing the full snapshot can
pass a `passthrough` resultMapper that ignores the prune.

## Properties

### narrative

> `readonly` **narrative**: readonly `object`[]

Defined in: [src/core/flowchartAsTool.ts:106](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/flowchartAsTool.ts#L106)

The flowchart's combined narrative entries (flow + data).
Useful for resultMappers that want to extract specific commit
artifacts or audit a decision path.

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:100](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/flowchartAsTool.ts#L100)

Final scope state — the merged result of every stage's writes.
This is what `executor.getSnapshot().values` returns.
