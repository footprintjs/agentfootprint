---
title: GraphOptions
---

# Interface: GraphOptions

Defined in: [src/core-flow/Graph.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L186)

## Properties

### edges

> `readonly` **edges**: readonly [`GraphEdge`](/docs/api/interfaces/GraphEdge)[]

Defined in: [src/core-flow/Graph.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L194)

The dependencies. Every endpoint must name a declared node.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Graph.ts:198](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L198)

Stable id used for topology + events. Default `'graph'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Graph.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L196)

Human-friendly name for events + topology. Default `'Graph'`.

***

### nodes

> `readonly` **nodes**: readonly [`GraphNode`](/docs/api/interfaces/GraphNode)\<`any`, `any`\>[]

Defined in: [src/core-flow/Graph.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L192)

The nodes. Ids must be unique; at least one is required.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Graph.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L206)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this graph's OWN nodes (Seed +
one mount per graph node + one join per level + Finalize). Not
propagated into the mounted node charts; attach them to each node
runner for full coverage.
