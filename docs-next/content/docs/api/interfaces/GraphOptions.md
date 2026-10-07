---
title: GraphOptions
---

# Interface: GraphOptions

Defined in: [src/core-flow/Graph.ts:174](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L174)

## Properties

### edges

> `readonly` **edges**: readonly [`GraphEdge`](/docs/api/interfaces/GraphEdge)[]

Defined in: [src/core-flow/Graph.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L182)

The dependencies. Every endpoint must name a declared node.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Graph.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L186)

Stable id used for topology + events. Default `'graph'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Graph.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L184)

Human-friendly name for events + topology. Default `'Graph'`.

***

### nodes

> `readonly` **nodes**: readonly [`GraphNode`](/docs/api/interfaces/GraphNode)\<`any`, `any`\>[]

Defined in: [src/core-flow/Graph.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L180)

The nodes. Ids must be unique; at least one is required.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Graph.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Graph.ts#L194)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this graph's OWN nodes (Seed +
one mount per graph node + one join per level + Finalize). Not
propagated into the mounted node charts; attach them to each node
runner for full coverage.
