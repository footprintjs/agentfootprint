---
title: LLMProvider
---

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L306)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L307)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/types.ts:312](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L312)

`hooks` (v7.8) is optional and additive — implementations may declare
`complete(req)` with no second parameter and stay assignable.

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

##### hooks?

[`LLMCallHooks`](/docs/api/interfaces/LLMCallHooks)

#### Returns

`Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

***

### stream()?

> `optional` **stream**(`req`, `hooks?`): `AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

Defined in: [src/adapters/types.ts:313](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L313)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

##### hooks?

[`LLMCallHooks`](/docs/api/interfaces/LLMCallHooks)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>
