---
title: MiddlewareAsk
---

# Interface: MiddlewareAsk

Defined in: [src/core/pause.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L71)

The question a `toolMiddleware` put to a person, as it rides the checkpoint.

## Properties

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: [src/core/pause.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L89)

Which REGISTERED screen component collects the answer (9.24.0) — the
typed half of the question, carried from `ask({ question, component })`.
Absent means what it always meant: render the prose. The answer comes
back through the same `CheckInDecision` either way.

***

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: [src/core/pause.ts:82](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L82)

Anything else the answering UI should render. Never interpreted here.

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/pause.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L78)

Names this request: the id a decision quotes
(`checkInApproved({ request: outcome.ask, by })`). Minted when the run
paused, unique to this pause, and bound to the exact call that runs on
approval — see `core/consentRequest.ts`.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: [src/core/pause.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L91)

`name` of the middleware that asked.

***

### question

> `readonly` **question**: `string`

Defined in: [src/core/pause.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/core/pause.ts#L80)

The question, in the middleware author's own words.
