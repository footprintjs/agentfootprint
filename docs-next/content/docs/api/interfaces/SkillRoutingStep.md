---
title: SkillRoutingStep
---

# Interface: SkillRoutingStep

Defined in: [src/lib/injection-engine/skillGraph.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L190)

One predicate on a skill's root→leaf decision path, and the branch taken.

## Properties

### branch

> `readonly` **branch**: `"yes"` \| `"no"`

Defined in: [src/lib/injection-engine/skillGraph.ts:194](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L194)

Which side of the predicate leads to this skill.

***

### label

> `readonly` **label**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L192)

The predicate's caption (the `decide(...)` label).
