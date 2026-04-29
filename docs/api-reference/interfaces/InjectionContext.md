[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionContext

# Interface: InjectionContext

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L79)

Context passed to `rule` predicates. Read-only snapshot of the
agent's iteration state. Internal mutable state is hidden.

## Properties

### activatedInjectionIds

> `readonly` **activatedInjectionIds**: readonly `string`[]

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L107)

IDs of LLM-activated injections that the LLM has activated this
turn (via their `viaToolName` tool call). Engine includes them
in the active set on subsequent iterations until turn end.

***

### history

> `readonly` **history**: readonly `object`[]

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:88](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L88)

Conversation history up to (but not including) the current
iteration's LLM call. Includes prior iterations within the same turn.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:81](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L81)

Current ReAct iteration (1-based).

***

### lastToolResult?

> `readonly` `optional` **lastToolResult?**: `object`

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:98](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L98)

The most recent tool result, if the previous iteration ended in a
tool call. Used both by `rule` predicates and by `on-tool-return`
trigger evaluation.

#### result

> `readonly` **result**: `string`

#### toolName

> `readonly` **toolName**: `string`

***

### userMessage

> `readonly` **userMessage**: `string`

Defined in: [agentfootprint/src/lib/injection-engine/types.ts:83](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/lib/injection-engine/types.ts#L83)

The current user message that started this turn.
