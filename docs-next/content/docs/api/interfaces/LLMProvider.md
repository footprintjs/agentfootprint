---
title: LLMProvider
---

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L321)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L322)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/types.ts:330](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L330)

`hooks` (v7.8) is optional and additive — implementations may declare
`complete(req)` with no second parameter and stay assignable. A LEAF
provider (one that talks to a vendor) may ignore it. A WRAPPER must
forward it, or everything it wraps goes silently dark — see the
`LLMCallHooks` docs above.

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

Defined in: [src/adapters/types.ts:331](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L331)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

##### hooks?

[`LLMCallHooks`](/docs/api/interfaces/LLMCallHooks)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>
