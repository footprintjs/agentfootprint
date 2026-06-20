---
title: FlowchartToolSnapshot
---

# Interface: FlowchartToolSnapshot

Defined in: [src/core/flowchartAsTool.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L105)

Pruned snapshot view passed to `resultMapper`. We keep this minimal
(the values bag + the chart's narrative entries) to avoid leaking
internal scope plumbing. Consumers needing the full snapshot can
pass a `passthrough` resultMapper that ignores the prune.

## Properties

### narrative

> `readonly` **narrative**: readonly `object`[]

Defined in: [src/core/flowchartAsTool.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L116)

The flowchart's combined narrative entries (flow + data).
Useful for resultMappers that want to extract specific commit
artifacts or audit a decision path.

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:110](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L110)

Final scope state — the merged result of every stage's writes.
This is what `executor.getSnapshot().values` returns.
