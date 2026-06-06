[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupMember

# Interface: GroupMember

Defined in: [src/core/translator.ts:61](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/translator.ts#L61)

One member of a composition. Shape is uniform across composition
kinds — Parallel branches, Sequence steps, Loop body, Conditional
branches, Agent tools/slots, LLMCall slots all map to this.

`memberId` is the stable id the composition assigned (e.g. `legal`
for a Parallel branch, `step-classify` for a Sequence step,
`body` for a Loop). Consumers can correlate this with the
SpecNode's `subflowId` / `id` to drill in.

`runner` is the underlying `Runner` instance — useful for the
consumer to call `member.runner.getSpec()` for the nested chart or
`member.runner.getUIGroup()` for the nested translation result
(when the same translator was threaded through that runner's
construction).

`uiGroup` is the member's already-translated output. Populated
when the consumer threaded the same `groupTranslator` reference
into each member's construction; `undefined` otherwise.

## Properties

### memberId

> `readonly` **memberId**: `string`

Defined in: [src/core/translator.ts:62](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/translator.ts#L62)

***

### runner

> `readonly` **runner**: [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)

Defined in: [src/core/translator.ts:63](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/translator.ts#L63)

***

### uiGroup?

> `readonly` `optional` **uiGroup?**: `unknown`

Defined in: [src/core/translator.ts:64](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/core/translator.ts#L64)
