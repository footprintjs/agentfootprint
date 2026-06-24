---
title: DecisionNode
---

# Interface: DecisionNode

Defined in: [src/lib/injection-engine/skillGraph.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L158)

A decision-tree node (v3): a predicate that branches to a subtree (or a skill
LEAF) on each side. The tree compiles to per-skill triggers — each leaf's
trigger is the conjunction of the predicates on its root→leaf path (with
earlier-sibling negation for if/else exclusivity), evaluated per iteration. So
"predicate nodes that route" needs NO engine change — same evaluator.

## Properties

### kind

> `readonly` **kind**: `"decision"`

Defined in: [src/lib/injection-engine/skillGraph.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L159)

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:164](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L164)

Caption for the predicate node when drawn (e.g. "io intent?").

***

### predicate

> `readonly` **predicate**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L160)

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`

***

### whenFalse

> `readonly` **whenFalse**: [`Injection`](/docs/api/interfaces/Injection) \| `DecisionNode`

Defined in: [src/lib/injection-engine/skillGraph.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L162)

***

### whenTrue

> `readonly` **whenTrue**: [`Injection`](/docs/api/interfaces/Injection) \| `DecisionNode`

Defined in: [src/lib/injection-engine/skillGraph.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L161)
