---
title: LLMCallBuilder
---

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall/builder.ts:7](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall/builder.ts#L7)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall/builder.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall/builder.ts#L14)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/docs/api/classes/LLMCall)

Defined in: [src/core/LLMCall/builder.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall/builder.ts#L39)

#### Returns

[`LLMCall`](/docs/api/classes/LLMCall)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall/builder.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall/builder.ts#L24)

Set the system prompt. Once per call — a second `.system()` used to
REPLACE the first in silence, so the instructions written first were
never sent and nothing said so. Join the parts yourself and pass one
string.

#### Parameters

##### prompt

`string`

#### Returns

`this`
