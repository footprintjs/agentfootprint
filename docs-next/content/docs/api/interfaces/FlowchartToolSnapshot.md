---
title: FlowchartToolSnapshot
---

# Interface: FlowchartToolSnapshot

Defined in: [src/core/flowchartAsTool.ts:153](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L153)

Pruned snapshot view passed to `resultMapper`. We keep this minimal
(the values bag + the chart's narrative entries) to avoid leaking
internal scope plumbing. Consumers needing the full snapshot can
pass a `passthrough` resultMapper that ignores the prune.

## Properties

### narrative

> `readonly` **narrative**: readonly `object`[]

Defined in: [src/core/flowchartAsTool.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L165)

The flowchart's combined narrative entries (flow + data).
Useful for resultMappers that want to extract specific commit
artifacts or audit a decision path.

***

### values

> `readonly` **values**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L159)

Final scope state — the merged result of every stage's writes, as the
tool may SHOW it: `executor.getSnapshot().sharedState` without a
`redact` policy, the redacted mirror with one (`servableSnapshot`).
