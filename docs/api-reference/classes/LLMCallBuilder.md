[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:554](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/LLMCall.ts#L554)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:558](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/LLMCall.ts#L558)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:567](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/LLMCall.ts#L567)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:562](https://github.com/footprintjs/agentfootprint/blob/455f6597240fc141458c0e86e6b1fbf49ea37d98/src/core/LLMCall.ts#L562)

#### Parameters

##### prompt

`string`

#### Returns

`this`
