---
title: PendingToolTransition
---

# Interface: PendingToolTransition

Defined in: [src/injection-engine/leases.ts:25](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L25)

The transition proposal the tool-calls stage ACCEPTED this iteration —
validated (graph mounted, target reachable), first-accepted-wins across
the batch. One-shot BY DATA, not by clearing writes: it is stamped with
the iteration that granted it, and the Evaluate stage honors it exactly
once — on the following iteration — so nothing ever has to write the key
back to undefined (zero-cost stays zero for agents that never see one).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/injection-engine/leases.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L33)

The ReAct iteration whose batch granted it (valid for iteration + 1).

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/injection-engine/leases.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L31)

The effect's own declared reason.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: [src/injection-engine/leases.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L26)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/injection-engine/leases.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L29)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/injection-engine/leases.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/injection-engine/leases.ts#L28)

The proposing tool — provenance for the record.
