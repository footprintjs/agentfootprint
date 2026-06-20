---
title: DecisionNode
---

# Interface: DecisionNode

Defined in: [src/lib/injection-engine/skillGraph.ts:168](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L168)

A decision-tree node (v3): a predicate that branches to a subtree (or a skill
LEAF) on each side. The tree compiles to per-skill triggers — each leaf's
trigger is the conjunction of the predicates on its root→leaf path (with
earlier-sibling negation for if/else exclusivity), evaluated per iteration. So
"predicate nodes that route" needs NO engine change — same evaluator.

## Properties

### kind

> `readonly` **kind**: `"decision"`

Defined in: [src/lib/injection-engine/skillGraph.ts:169](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L169)

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:174](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L174)

Caption for the predicate node when drawn (e.g. "io intent?").

***

### predicate

> `readonly` **predicate**: (`ctx`) => `boolean`

Defined in: [src/lib/injection-engine/skillGraph.ts:170](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L170)

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`boolean`

***

### whenFalse

> `readonly` **whenFalse**: [`Injection`](/docs/api/interfaces/Injection) \| `DecisionNode`

Defined in: [src/lib/injection-engine/skillGraph.ts:172](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L172)

***

### whenTrue

> `readonly` **whenTrue**: [`Injection`](/docs/api/interfaces/Injection) \| `DecisionNode`

Defined in: [src/lib/injection-engine/skillGraph.ts:171](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L171)
