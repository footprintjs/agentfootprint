[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / graph

# Function: graph()

> **graph**(`opts`): [`Graph`](/agentfootprint/api/generated/classes/Graph.md)

Defined in: [src/core-flow/Graph.ts:758](https://github.com/footprintjs/agentfootprint/blob/e2a169f27b476cdd0e6f7bc3bc9b3ad9c33173cb/src/core-flow/Graph.ts#L758)

Build a fixed DAG of runners. Independent nodes run concurrently; the
result is every node's output, keyed by node id.

The shape is checked at BUILD time — a cycle, an edge pointing at an
unknown node, a duplicate id, or a 2+-parent node with no `join` throws
here, naming the offender, rather than misbehaving mid-run.

## Parameters

### opts

[`GraphOptions`](/agentfootprint/api/generated/interfaces/GraphOptions.md)

## Returns

[`Graph`](/agentfootprint/api/generated/classes/Graph.md)

## Example

**a fan-out with a merge**

```ts
const pipeline = graph({
  nodes: [
    { id: 'plan', runner: planner },
    { id: 'search', runner: searcher },
    { id: 'recall', runner: memory },
    { id: 'answer', runner: writer, join: (u) => ({ ...u }) },
  ],
  edges: [
    { from: 'plan', to: 'search' },
    { from: 'plan', to: 'recall' },
    { from: 'search', to: 'answer' },
    { from: 'recall', to: 'answer' },
  ],
});

const out = await pipeline.run({ message: 'what changed last week?' });
console.log(out.answer);
```
