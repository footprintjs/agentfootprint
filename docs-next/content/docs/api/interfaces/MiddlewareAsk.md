---
title: MiddlewareAsk
---

# Interface: MiddlewareAsk

Defined in: src/core/pause.ts:67

The question a `toolMiddleware` put to a person, as it rides the checkpoint.

## Properties

### component?

> `readonly` `optional` **component?**: [`AskComponent`](/docs/api/interfaces/AskComponent)

Defined in: src/core/pause.ts:78

Which REGISTERED screen component collects the answer (9.24.0) — the
typed half of the question, carried from `ask({ question, component })`.
Absent means what it always meant: render the prose. The answer comes
back through the same `CheckInDecision` either way.

***

### detail?

> `readonly` `optional` **detail?**: `unknown`

Defined in: src/core/pause.ts:71

Anything else the answering UI should render. Never interpreted here.

***

### middleware

> `readonly` **middleware**: `string`

Defined in: src/core/pause.ts:80

`name` of the middleware that asked.

***

### question

> `readonly` **question**: `string`

Defined in: src/core/pause.ts:69

The question, in the middleware author's own words.
