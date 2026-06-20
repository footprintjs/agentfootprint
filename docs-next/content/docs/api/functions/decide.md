---
title: decide
---

# Function: decide()

> **decide**(`predicate`, `whenTrue`, `whenFalse`, `label?`): [`DecisionNode`](/docs/api/interfaces/DecisionNode)

Defined in: [src/lib/injection-engine/skillGraph.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L179)

Build a decision node. Leaves are skills (an `Injection`); internal nodes are
 other `decide(...)` results.

## Parameters

### predicate

(`ctx`) => `boolean`

### whenTrue

[`Injection`](/docs/api/interfaces/Injection) \| [`DecisionNode`](/docs/api/interfaces/DecisionNode)

### whenFalse

[`Injection`](/docs/api/interfaces/Injection) \| [`DecisionNode`](/docs/api/interfaces/DecisionNode)

### label?

`string`

## Returns

[`DecisionNode`](/docs/api/interfaces/DecisionNode)
