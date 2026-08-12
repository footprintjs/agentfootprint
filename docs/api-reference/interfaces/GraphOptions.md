[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GraphOptions

# Interface: GraphOptions

Defined in: [src/core-flow/Graph.ts:171](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L171)

## Properties

### edges

> `readonly` **edges**: readonly [`GraphEdge`](/agentfootprint/api/generated/interfaces/GraphEdge.md)[]

Defined in: [src/core-flow/Graph.ts:179](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L179)

The dependencies. Every endpoint must name a declared node.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Graph.ts:183](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L183)

Stable id used for topology + events. Default `'graph'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Graph.ts:181](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L181)

Human-friendly name for events + topology. Default `'Graph'`.

***

### nodes

> `readonly` **nodes**: readonly [`GraphNode`](/agentfootprint/api/generated/interfaces/GraphNode.md)\<`any`, `any`\>[]

Defined in: [src/core-flow/Graph.ts:177](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L177)

The nodes. Ids must be unique; at least one is required.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Graph.ts:191](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core-flow/Graph.ts#L191)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this graph's OWN nodes (Seed +
one mount per graph node + one join per level + Finalize). Not
propagated into the mounted node charts; attach them to each node
runner for full coverage.
