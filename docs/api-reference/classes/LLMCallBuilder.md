[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:601](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/LLMCall.ts#L601)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:608](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/LLMCall.ts#L608)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:633](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/LLMCall.ts#L633)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:618](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/LLMCall.ts#L618)

Set the system prompt. Once per call — a second `.system()` used to
REPLACE the first in silence, so the instructions written first were
never sent and nothing said so. Join the parts yourself and pass one
string.

#### Parameters

##### prompt

`string`

#### Returns

`this`
