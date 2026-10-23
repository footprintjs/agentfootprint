---
title: MiddlewareDecision
---

# Interface: MiddlewareDecision

Defined in: [src/core/agent/middleware/types.ts:325](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L325)

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:373](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L373)

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: [src/core/agent/middleware/types.ts:339](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L339)

Which chain this row came from. The older spelling — see `moment`.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:371](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L371)

The value before this middleware. Present only when `changed`.

At `'after-tool'` this is the tool's REAL result — including on a
refusal, because the side effect happened and a record that dropped it
would be a record that lies. It is not the only copy: by design
`agentfootprint.stream.tool_end` reports the same real result. If it must
not survive in a record, name it in the agent's `redact`
(`Agent.create({ redact })` — `conversationRedaction()` names
`middlewareDecisions` and `result`): the row survives, the value does not.

***

### changed

> `readonly` **changed**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:357](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L357)

True when this row changed the value the chain carries forward.

A refusal at `'before-tool'` leaves nothing to change — the call does not
happen. A refusal at `'after-tool'` DOES change something: the tool ran,
and the model is handed the reason instead of what came back. Those rows
carry `changed: true` with the real result in `before`.

***

### changedKeys?

> `readonly` `optional` **changedKeys?**: readonly `string`[]

Defined in: [src/core/agent/middleware/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L392)

The NAMES of the arguments this before-tool rewrite changed (honesty
layer 2) — filed only on an agent whose inputs layer is armed, for a call
whose tool declares argument rules; names only, never values (the row
already carries `before` and `after`). The answer's standing reads a
rewrite of a RULED argument with no declared origin as assumed.

***

### componentId?

> `readonly` `optional` **componentId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:379](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L379)

The registered component that COLLECTED this decision (9.24.0). Present
only on the resume-side rows of an `ask` that carried one — the trace
then says which surface the person answered through. Never inferred.

***

### from?

> `readonly` `optional` **from?**: `Readonly`\<`Record`\<`string`, `"person"` \| `"default"` \| `"app"`\>\>

Defined in: [src/core/agent/middleware/types.ts:384](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L384)

The middleware's own declaration of where the rewritten values came from
(`allow(args, why, { from })`) — present only when it declared one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L347)

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/types.ts:327](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L327)

The middleware's `name`.

***

### moment

> `readonly` **moment**: `"input"` \| `"output"` \| `"before-tool"` \| `"after-tool"` \| `"window"`

Defined in: [src/core/agent/middleware/types.ts:337](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L337)

WHERE IN THE LOOP this decision happened — the same five words `.act()`
is keyed on, so a row and the door that filed it are read in one
vocabulary.

`at` and `phase` below say the same thing in the spelling 7.18 shipped
with. They are committed state and they are not going anywhere; this is
the newer word for the same fact, and the one to narrow on.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: [src/core/agent/middleware/types.ts:348](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L348)

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L341)

Message chain only. The older spelling — see `moment`.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:345](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L345)

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/middleware/types.ts:343](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L343)

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:359](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L359)

The transform's `why`, the denial's `reason`, or the ask's `question`.
