[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ProposeTransitionEffect

# Interface: ProposeTransitionEffect

Defined in: [src/core/agent/toolEffects.ts:68](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/toolEffects.ts#L68)

A tool proposes moving the skill-graph cursor. The graph decides.

## Properties

### kind

> `readonly` **kind**: `"propose-transition"`

Defined in: [src/core/agent/toolEffects.ts:69](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/toolEffects.ts#L69)

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/toolEffects.ts:76](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/toolEffects.ts#L76)

Why — goes on the record (`tools.effect`), never optional: a routing
 proposal with no reason is exactly the arbitrary authority this
 channel exists to replace.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: [src/core/agent/toolEffects.ts:72](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/toolEffects.ts#L72)

The skill node to move to. Reachability-checked against the graph's
 own law (`reachableSkills(cursor)`); unreachable = teaching refusal.
