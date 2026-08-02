---
title: GraphNode<I, O>
---

# Interface: GraphNode\<I, O\>

Defined in: src/core-flow/Graph.ts:140

One node of the graph: an id, the runner that does the work, and — when
the node has more than one parent — how to merge what those parents
produced into this node's input.

## Type Parameters

### I

`I` = `unknown`

### O

`O` = `unknown`

## Properties

### id

> `readonly` **id**: `string`

Defined in: src/core-flow/Graph.ts:142

Unique within the graph. Used as the results key and the chart node id.

***

### join?

> `readonly` `optional` **join?**: (`upstream`) => `I`

Defined in: src/core-flow/Graph.ts:153

Merge upstream outputs into this node's input. `upstream` is keyed by
PARENT NODE ID, and each value is that parent's output, unchanged.

Optional for a node with 0 or 1 parents (a single parent's output is
passed through). **REQUIRED when a node has 2+ parents** — a silent
merge is a wrong merge, so the build refuses and names the node.

#### Parameters

##### upstream

`Readonly`\<`Record`\<`string`, `unknown`\>\>

#### Returns

`I`

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/core-flow/Graph.ts:155

Human-friendly label for events + topology. Default: the node id.

***

### runner

> `readonly` **runner**: [`Runner`](/docs/api/interfaces/Runner)\<`I`, `O`\>

Defined in: src/core-flow/Graph.ts:144

The work. Any Runner: LLMCall, Agent, a Sequence, another graph.
