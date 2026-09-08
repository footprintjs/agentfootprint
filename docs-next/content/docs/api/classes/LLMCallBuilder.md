---
title: LLMCallBuilder
---

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:622](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L622)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:629](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L629)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/docs/api/classes/LLMCall)

Defined in: [src/core/LLMCall.ts:654](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L654)

#### Returns

[`LLMCall`](/docs/api/classes/LLMCall)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:639](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L639)

Set the system prompt. Once per call — a second `.system()` used to
REPLACE the first in silence, so the instructions written first were
never sent and nothing said so. Join the parts yourself and pass one
string.

#### Parameters

##### prompt

`string`

#### Returns

`this`
