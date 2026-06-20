---
title: LLMProvider
---

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/types.ts#L230)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/types.ts#L231)

## Methods

### complete()

> **complete**(`req`): `Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

Defined in: [src/adapters/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/types.ts#L232)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`Promise`\<[`LLMResponse`](/docs/api/interfaces/LLMResponse)\>

***

### stream()?

> `optional` **stream**(`req`): `AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>

Defined in: [src/adapters/types.ts:233](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/adapters/types.ts#L233)

#### Parameters

##### req

[`LLMRequest`](/docs/api/interfaces/LLMRequest)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/docs/api/interfaces/LLMChunk)\>
