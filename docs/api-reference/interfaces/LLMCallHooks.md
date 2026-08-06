[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallHooks

# Interface: LLMCallHooks

Defined in: [src/adapters/types.ts:381](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L381)

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

⚠ **IF YOU WRITE A PROVIDER WRAPPER, FORWARD THIS PARAMETER.** It is the
one silent-failure trap in the design. A wrapper that declares
`complete(req)` and calls `inner.complete(req)` still type-checks
perfectly — `hooks` is optional, and TypeScript has never rejected an
implementation for taking FEWER parameters than its signature — so
dropping it produces no compile error, no runtime error, and no test
failure. What it produces is a decorated provider that goes DARK the
moment it is placed underneath: the reports still happen, and nothing
receives them. Every wrapper shipped in this library forwards (the three
`src/resilience/` decorators, and all eight class-form / Azure wrappers
in `src/adapters/llm/`), so the trap can only be sprung by a
consumer-authored wrapper — `myWrapper(withRetry(p))`. There is no way to
police it from here; the only defence is this note and the one in the
resilience guide's "honest limits".

## Properties

### onResilience?

> `readonly` `optional` **onResilience?**: (`report`) => `void`

Defined in: [src/adapters/types.ts:388](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L388)

Called once per resilience decision (a fallback, a retry, a
recovery). Decorators forward this hook inward unchanged, so a
stack of decorators produces one concatenated report stream with no
duplication.

#### Parameters

##### report

[`ResilienceReport`](/agentfootprint/api/generated/type-aliases/ResilienceReport.md)

#### Returns

`void`
