[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MiddlewareAsk

# Interface: MiddlewareAsk

Defined in: [src/core/pause.ts:63](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L63)

The question a `toolMiddleware` put to a person, as it rides the checkpoint.

## Properties

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/agentfootprint/api/generated/interfaces/AskComponent.md)

Defined in: [src/core/pause.ts:74](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L74)

Which REGISTERED screen component collects the answer (9.24.0) — the
typed half of the question, carried from `ask({ question, component })`.
Absent means what it always meant: render the prose. The answer comes
back through the same `CheckInDecision` either way.

***

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/pause.ts:67](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L67)

Anything else the answering UI should render. Never interpreted here.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/pause.ts:76](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L76)

`name` of the middleware that asked.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/pause.ts:65](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/pause.ts#L65)

The question, in the middleware author's own words.
