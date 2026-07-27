---
title: LLMCallHooks
---

# Interface: LLMCallHooks

Defined in: [src/adapters/types.ts:296](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L296)

v7.8 — optional per-call hooks the CALLER hands a provider.

Lets a resilience decorator report what it did to whoever invoked it,
without the decorator knowing anything about runs, scopes, or events.
The channel rides the CALL (not the factory) because decorators are
constructed by the consumer before any run exists.

Passed by agentfootprint's in-run LLM call sites, which translate each
report into an already-declared typed event with real correlation ids.
Outside a run nothing passes hooks, so `hooks` is `undefined` and every
report site short-circuits — standalone decorator behaviour is
unchanged.

## Properties

### onResilience?

> `readonly` `optional` **onResilience?**: (`report`) => `void`

Defined in: [src/adapters/types.ts:303](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L303)

Called once per resilience decision (a fallback, a retry, a
recovery). Decorators forward this hook inward unchanged, so a
stack of decorators produces one concatenated report stream with no
duplication.

#### Parameters

##### report

[`ResilienceReport`](/docs/api/type-aliases/ResilienceReport)

#### Returns

`void`
