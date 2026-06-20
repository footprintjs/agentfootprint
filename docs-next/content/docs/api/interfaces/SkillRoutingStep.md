---
title: SkillRoutingStep
---

# Interface: SkillRoutingStep

Defined in: [src/lib/injection-engine/skillGraph.ts:200](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L200)

One predicate on a skill's root→leaf decision path, and the branch taken.

## Properties

### branch

> `readonly` **branch**: `"yes"` \| `"no"`

Defined in: [src/lib/injection-engine/skillGraph.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L204)

Which side of the predicate leads to this skill.

***

### label

> `readonly` **label**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L202)

The predicate's caption (the `decide(...)` label).
