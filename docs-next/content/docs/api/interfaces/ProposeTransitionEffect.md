---
title: ProposeTransitionEffect
---

# Interface: ProposeTransitionEffect

Defined in: [src/semantics/toolEffects.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L69)

A tool proposes moving the skill-graph cursor. The graph decides.

## Properties

### kind

> `readonly` **kind**: `"propose-transition"`

Defined in: [src/semantics/toolEffects.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L70)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/semantics/toolEffects.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L77)

Why — goes on the record (`tools.effect`), never optional: a routing
 proposal with no reason is exactly the arbitrary authority this
 channel exists to replace.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: [src/semantics/toolEffects.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/semantics/toolEffects.ts#L73)

The skill node to move to. Reachability-checked against the graph's
 own law (`reachableSkills(cursor)`); unreachable = teaching refusal.
