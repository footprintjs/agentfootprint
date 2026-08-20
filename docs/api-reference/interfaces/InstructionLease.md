[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InstructionLease

# Interface: InstructionLease

Defined in: [src/core/agent/toolEffects.ts:302](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L302)

One granted `require-instruction` lease. Validity is COMPUTED, never
mutated: `'next-call'` serves exactly the Evaluate pass of
`iteration + 1`; `'until-skill-exit'` serves every pass while the tenant
that granted it (`skillId`) still holds the tenure.

Death is PERMANENT, and the Evaluate tenure sweep is what makes it so:
`skillId === tenant` alone cannot tell "still holding the tenure" from
"re-entered the skill later" (a cyclic graph makes both real), so the
Evaluate stage prunes dead leases on EVERY pass — the same pass a tenure
ends, the leases it granted leave the record, and a cursor that comes back
finds nothing to resurrect. The tool-calls stage also prunes when it
appends a new grant (keeps mid-batch arrays tight), but the sweep is the
law's owner: it runs whether or not anything new was granted.

## Properties

### deliveryLease

> `readonly` **deliveryLease**: [`InstructionDeliveryLease`](/agentfootprint/api/generated/type-aliases/InstructionDeliveryLease.md)

Defined in: [src/core/agent/toolEffects.ts:304](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L304)

***

### instructionId

> `readonly` **instructionId**: `string`

Defined in: [src/core/agent/toolEffects.ts:303](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L303)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/toolEffects.ts:313](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L313)

The ReAct iteration whose batch granted it.

***

### skillId?

> `readonly` `optional` **skillId?**: `string`

Defined in: [src/core/agent/toolEffects.ts:308](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L308)

The tenure that granted it (advanced cursor, else the activation tail);
 absent when no tenant existed at grant. `'until-skill-exit'` compares
 the CURRENT tenant against this — both-undefined still matches.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/toolEffects.ts:311](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L311)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/toolEffects.ts:310](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolEffects.ts#L310)

The granting tool — provenance for the record.
