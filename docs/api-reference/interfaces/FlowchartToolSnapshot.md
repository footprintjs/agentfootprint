[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartToolSnapshot

# Interface: FlowchartToolSnapshot

Defined in: [src/core/flowchartAsTool.ts:145](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/core/flowchartAsTool.ts#L145)

Pruned snapshot view passed to `resultMapper`. We keep this minimal
(the values bag + the chart's narrative entries) to avoid leaking
internal scope plumbing. Consumers needing the full snapshot can
pass a `passthrough` resultMapper that ignores the prune.

## Properties

### narrative

> `readonly` **narrative**: readonly `object`[]

Defined in: [src/core/flowchartAsTool.ts:156](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/core/flowchartAsTool.ts#L156)

The flowchart's combined narrative entries (flow + data).
Useful for resultMappers that want to extract specific commit
artifacts or audit a decision path.

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:150](https://github.com/footprintjs/agentfootprint/blob/095851064601e5ceb1fe1d6417a01f0c1cb4d731/src/core/flowchartAsTool.ts#L150)

Final scope state — the merged result of every stage's writes.
This is what `executor.getSnapshot().values` returns.
