[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMProvider

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L321)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L322)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/types.ts:330](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L330)

`hooks` (v7.8) is optional and additive — implementations may declare
`complete(req)` with no second parameter and stay assignable. A LEAF
provider (one that talks to a vendor) may ignore it. A WRAPPER must
forward it, or everything it wraps goes silently dark — see the
`LLMCallHooks` docs above.

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

***

### stream()?

> `optional` **stream**(`req`, `hooks?`): `AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

Defined in: [src/adapters/types.ts:331](https://github.com/footprintjs/agentfootprint/blob/6d7498c2fc112b3787418f14708897a47e933fd6/src/adapters/types.ts#L331)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>
