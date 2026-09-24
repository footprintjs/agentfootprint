[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCallBuilder

# Class: LLMCallBuilder

Defined in: [src/core/LLMCall.ts:721](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/LLMCall.ts#L721)

Tiny fluent builder. Validates required fields at build() time.

## Constructors

### Constructor

> **new LLMCallBuilder**(`opts`): `LLMCallBuilder`

Defined in: [src/core/LLMCall.ts:728](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/LLMCall.ts#L728)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

`LLMCallBuilder`

## Methods

### build()

> **build**(): [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

Defined in: [src/core/LLMCall.ts:753](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/LLMCall.ts#L753)

#### Returns

[`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)

***

### system()

> **system**(`prompt`): `this`

Defined in: [src/core/LLMCall.ts:738](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/LLMCall.ts#L738)

Set the system prompt. Once per call — a second `.system()` used to
REPLACE the first in silence, so the instructions written first were
never sent and nothing said so. Join the parts yourself and pass one
string.

#### Parameters

##### prompt

`string`

#### Returns

`this`
