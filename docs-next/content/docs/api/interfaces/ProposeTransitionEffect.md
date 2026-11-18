---
title: ProposeTransitionEffect
---

# Interface: ProposeTransitionEffect

Defined in: [src/semantics/toolEffects.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L72)

A tool proposes moving the skill-graph cursor. The graph decides.

## Properties

### kind

> `readonly` **kind**: `"propose-transition"`

Defined in: [src/semantics/toolEffects.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L73)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/semantics/toolEffects.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L80)

Why — goes on the record (`tools.effect`), never optional: a routing
 proposal with no reason is exactly the arbitrary authority this
 channel exists to replace.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: [src/semantics/toolEffects.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L76)

The skill node to move to. Reachability-checked against the graph's
 own law (`reachableSkills(cursor)`); unreachable = teaching refusal.
