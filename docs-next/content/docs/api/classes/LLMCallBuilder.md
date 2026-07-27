---
title: LLMCallBuilder
---

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:554](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L554)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:558](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L558)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/docs/api/classes/LLMCall)

Defined in: [src/core/LLMCall.ts:567](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L567)

#### Returns

[`LLMCall`](/docs/api/classes/LLMCall)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:562](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L562)

#### Parameters

##### prompt

`string`

#### Returns

`this`
