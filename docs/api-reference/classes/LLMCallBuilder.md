[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:601](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/LLMCall.ts#L601)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:605](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/LLMCall.ts#L605)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:614](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/LLMCall.ts#L614)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:609](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/LLMCall.ts#L609)

#### Parameters

##### prompt

`string`

#### Returns

`this`
