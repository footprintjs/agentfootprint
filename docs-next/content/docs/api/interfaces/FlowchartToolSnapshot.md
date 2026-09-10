---
title: FlowchartToolSnapshot
---

# Interface: FlowchartToolSnapshot

Defined in: [src/core/flowchartAsTool.ts:152](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L152)

Pruned snapshot view passed to `resultMapper`. We keep this minimal
(the values bag + the chart's narrative entries) to avoid leaking
internal scope plumbing. Consumers needing the full snapshot can
pass a `passthrough` resultMapper that ignores the prune.

## Properties

### narrative

> `readonly` **narrative**: readonly `object`[]

Defined in: [src/core/flowchartAsTool.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L164)

The flowchart's combined narrative entries (flow + data).
Useful for resultMappers that want to extract specific commit
artifacts or audit a decision path.

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L158)

Final scope state — the merged result of every stage's writes, as the
tool may SHOW it: `executor.getSnapshot().sharedState` without a
`redact` policy, the redacted mirror with one (`servableSnapshot`).
