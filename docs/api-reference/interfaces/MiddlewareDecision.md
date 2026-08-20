[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MiddlewareDecision

# Interface: MiddlewareDecision

Defined in: [src/core/agent/middleware/types.ts:313](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L313)

One row per middleware decision, committed to `scope.middlewareDecisions`.

Every decision files a row, including the pass-throughs. A chain that
only recorded its refusals would leave you unable to tell "the middleware
looked and was fine with it" apart from "the middleware never ran" — and
those are different facts about a run.

## Properties

### after?

> `readonly` `optional` **after?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:359](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L359)

The value after this middleware. Present only when `changed`.

***

### at

> `readonly` **at**: `"tool"` \| `"message"`

Defined in: [src/core/agent/middleware/types.ts:327](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L327)

Which chain this row came from. The older spelling — see `moment`.

***

### before?

> `readonly` `optional` **before?**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:357](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L357)

The value before this middleware. Present only when `changed`.

At `'after-tool'` this is the tool's REAL result — including on a
refusal, where it is the only copy in the run, because the side effect
happened and a record that dropped it would be a record that lies. If it
must not survive in the commit log, that is footprintjs redaction over
this key: the row survives, the value does not.

***

### changed

> `readonly` **changed**: `boolean`

Defined in: [src/core/agent/middleware/types.ts:345](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L345)

True when this row changed the value the chain carries forward.

A refusal at `'before-tool'` leaves nothing to change — the call does not
happen. A refusal at `'after-tool'` DOES change something: the tool ran,
and the model is handed the reason instead of what came back. Those rows
carry `changed: true` with the real result in `before`.

***

### componentId?

> `readonly` `optional` **componentId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:365](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L365)

The registered component that COLLECTED this decision (9.24.0). Present
only on the resume-side rows of an `ask` that carried one — the trace
then says which surface the person answered through. Never inferred.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:335](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L335)

ReAct iteration. `0` for the `'input'` phase, which runs before iter 1.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/agent/middleware/types.ts:315](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L315)

The middleware's `name`.

***

### moment

> `readonly` **moment**: `"input"` \| `"output"` \| `"before-tool"` \| `"after-tool"` \| `"window"`

Defined in: [src/core/agent/middleware/types.ts:325](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L325)

WHERE IN THE LOOP this decision happened — the same five words `.act()`
is keyed on, so a row and the door that filed it are read in one
vocabulary.

`at` and `phase` below say the same thing in the spelling 7.18 shipped
with. They are committed state and they are not going anywhere; this is
the newer word for the same fact, and the one to narrow on.

***

### outcome

> `readonly` **outcome**: `"allow"` \| `"deny"` \| `"ask"`

Defined in: [src/core/agent/middleware/types.ts:336](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L336)

***

### phase?

> `readonly` `optional` **phase?**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:329](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L329)

Message chain only. The older spelling — see `moment`.

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [src/core/agent/middleware/types.ts:333](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L333)

Tool chain only.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/core/agent/middleware/types.ts:331](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L331)

Tool chain only.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: [src/core/agent/middleware/types.ts:347](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/middleware/types.ts#L347)

The transform's `why`, the denial's `reason`, or the ask's `question`.
