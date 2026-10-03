---
title: PendingToolTransition
---

# Interface: PendingToolTransition

Defined in: src/core/agent/toolEffects.ts:276

The transition proposal the tool-calls stage ACCEPTED this iteration —
validated (graph mounted, target reachable), first-accepted-wins across
the batch. One-shot BY DATA, not by clearing writes: it is stamped with
the iteration that granted it, and the Evaluate stage honors it exactly
once — on the following iteration — so nothing ever has to write the key
back to undefined (zero-cost stays zero for agents that never see one).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/toolEffects.ts:284

The ReAct iteration whose batch granted it (valid for iteration + 1).

***

### reason

> `readonly` **reason**: `string`

Defined in: src/core/agent/toolEffects.ts:282

The effect's own declared reason.

***

### targetSkillId

> `readonly` **targetSkillId**: `string`

Defined in: src/core/agent/toolEffects.ts:277

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: src/core/agent/toolEffects.ts:280

***

### toolName

> `readonly` **toolName**: `string`

Defined in: src/core/agent/toolEffects.ts:279

The proposing tool — provenance for the record.
