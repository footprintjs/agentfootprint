---
title: MiddlewareDecision
---

# Interface: MiddlewareDecision

Defined in: [src/core/agent/middleware/types.ts:343](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L343)

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:400](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L400)

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: [src/core/agent/middleware/types.ts:363](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L363)

Which chain this row came from. The older spelling — see `moment`.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:398](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L398)

The value before this middleware. Present only when `changed`.

At `'after-tool'` this is the tool's REAL result — including on a
refusal, because the side effect happened and a record that dropped it
would be a record that lies. It is not the only copy: by design
`agentfootprint.stream.tool_end` reports the same real result. If it must
not survive in a record, name it in the agent's `redact`
(`Agent.create({ redact })` — `conversationRedaction()` names
`middlewareDecisions` and `result`): the row survives, the value does not.

***

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/core/agent/middleware/types.ts:344](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L344)

***

### changed

> `readonly` **changed**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:384](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L384)

True when this row changed the value the chain carries forward.

A refusal at `'before-tool'` leaves nothing to change — the call does not
happen. A refusal at `'after-tool'` DOES change something: the tool ran,
and the model is handed the reason instead of what came back. Those rows
carry `changed: true` with the real result in `before`.

***

### changedKeys?

> `readonly` `optional` **changedKeys?**: readonly `string`[]

Defined in: [src/core/agent/middleware/types.ts:419](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L419)

The NAMES of the arguments this before-tool rewrite changed (honesty
layer 2) — filed only on an agent whose inputs layer is armed, for a call
whose tool declares argument rules; names only, never values (the row
already carries `before` and `after`). The answer's standing reads a
rewrite of a RULED argument with no declared origin as assumed.

***

### componentId?

> `readonly` `optional` **componentId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L406)

The registered component that COLLECTED this decision (9.24.0). Present
only on the resume-side rows of an `ask` that carried one — the trace
then says which surface the person answered through. Never inferred.

***

### from?

> `readonly` `optional` **from?**: `Readonly`\<`Record`\<`string`, `"person"` \| `"default"` \| `"app"`\>\>

Defined in: [src/core/agent/middleware/types.ts:411](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L411)

The middleware's own declaration of where the rewritten values came from
(`allow(args, why, { from })`) — present only when it declared one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:373](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L373)

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/types.ts:351](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L351)

The middleware's `name`.

***

### moment

> `readonly` **moment**: `"input"` \| `"output"` \| `"before-tool"` \| `"after-tool"` \| `"window"`

Defined in: [src/core/agent/middleware/types.ts:361](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L361)

WHERE IN THE LOOP this decision happened — the same five words `.act()`
is keyed on, so a row and the door that filed it are read in one
vocabulary.

`at` and `phase` below say the same thing in the spelling 7.18 shipped
with. They are committed state and they are not going anywhere; this is
the newer word for the same fact, and the one to narrow on.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"refused"` \| `"ask"`

Defined in: [src/core/agent/middleware/types.ts:375](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L375)

`refused` is the library's decision on an unrecognised middleware answer.

***

### personApproved?

> `readonly` `optional` **personApproved?**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:367](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L367)

The person's answer to a middleware ask. Present only on the answer row.

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"` \| `"resume"`

Defined in: [src/core/agent/middleware/types.ts:365](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L365)

Message boundary phase, or `resume` when a tool gate is asked again.

***

### resultEffects?

> `readonly` `optional` **resultEffects?**: \{ `disposition`: `"suppressed"`; \} \| \{ `disposition`: `"admitted"`; `proposalOrdinals`: readonly `number`[]; \}

Defined in: [src/core/agent/middleware/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L347)

Settlement's private handoff of typed proposals to the graph/lease owners.
This result-policy decision does not assert that any proposal took effect.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:371](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L371)

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/middleware/types.ts:369](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L369)

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:386](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L386)

The transform's `why`, the denial's `reason`, the ask's `question`, or the library's refusal.
