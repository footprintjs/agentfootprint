[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:554](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/LLMCall.ts#L554)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:558](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/LLMCall.ts#L558)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:567](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/LLMCall.ts#L567)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:562](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/LLMCall.ts#L562)

#### Parameters

##### prompt

`string`

#### Returns

`this`
