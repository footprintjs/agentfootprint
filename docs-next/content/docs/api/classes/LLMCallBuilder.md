---
title: LLMCallBuilder
---

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:719](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L719)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:726](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L726)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/docs/api/classes/LLMCall)

Defined in: [src/core/LLMCall.ts:751](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L751)

#### Returns

[`LLMCall`](/docs/api/classes/LLMCall)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:736](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L736)

Set the system prompt. Once per call — a second `.system()` used to
REPLACE the first in silence, so the instructions written first were
never sent and nothing said so. Join the parts yourself and pass one
string.

#### Parameters

##### prompt

`string`

#### Returns

`this`
