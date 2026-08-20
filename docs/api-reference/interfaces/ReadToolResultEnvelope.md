[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ReadToolResultEnvelope

# Interface: ReadToolResultEnvelope

Defined in: [src/core/agent/toolEffects.ts:123](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L123)

A recognized envelope, read: content unwrapped, VALID effects listed,
 malformed ones named (one teaching entry per bad effect).

## Properties

### content

> `readonly` **content**: `unknown`

Defined in: [src/core/agent/toolEffects.ts:124](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L124)

***

### effects

> `readonly` **effects**: readonly [`ProposedEffect`](/agentfootprint/api/generated/type-aliases/ProposedEffect.md)[]

Defined in: [src/core/agent/toolEffects.ts:125](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L125)

***

### malformed

> `readonly` **malformed**: readonly `object`[]

Defined in: [src/core/agent/toolEffects.ts:129](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L129)

Effects that carried a known `kind` with malformed fields — refused
 loudly (recorded + a teaching sentence), never half-applied.

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/agentfootprint/api/generated/type-aliases/ToolResultStatus.md)

Defined in: [src/core/agent/toolEffects.ts:126](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L126)
