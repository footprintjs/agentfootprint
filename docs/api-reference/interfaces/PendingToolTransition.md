[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / PendingToolTransition

# Interface: PendingToolTransition

Defined in: [src/core/agent/toolEffects.ts:276](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L276)

The transition proposal the tool-calls stage ACCEPTED this iteration —
validated (graph mounted, target reachable), first-accepted-wins across
the batch. One-shot BY DATA, not by clearing writes: it is stamped with
the iteration that granted it, and the Evaluate stage honors it exactly
once — on the following iteration — so nothing ever has to write the key
back to undefined (zero-cost stays zero for agents that never see one).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/toolEffects.ts:284](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L284)

The ReAct iteration whose batch granted it (valid for iteration + 1).

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/toolEffects.ts:282](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L282)

The effect's own declared reason.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: [src/core/agent/toolEffects.ts:277](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L277)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/toolEffects.ts:280](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L280)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/toolEffects.ts:279](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L279)

The proposing tool — provenance for the record.
