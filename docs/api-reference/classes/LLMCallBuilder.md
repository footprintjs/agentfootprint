[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:543](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/LLMCall.ts#L543)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:547](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/LLMCall.ts#L547)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:556](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/LLMCall.ts#L556)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:551](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/LLMCall.ts#L551)

#### Parameters

##### prompt

`string`

#### Returns

`this`
