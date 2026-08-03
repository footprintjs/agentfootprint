[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMProvider

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/adapters/types.ts#L321)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/adapters/types.ts#L322)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/types.ts:330](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/adapters/types.ts#L330)

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

Defined in: [src/adapters/types.ts:331](https://github.com/footprintjs/agentfootprint/blob/5e50b8a4c2f3ab01f1019c813d5c48641d801965/src/adapters/types.ts#L331)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>
