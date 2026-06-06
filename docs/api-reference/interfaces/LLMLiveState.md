[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMLiveState

# Interface: LLMLiveState

Defined in: [src/recorders/observability/LiveStateRecorder.ts:83](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L83)

Live transient state of one in-flight LLM call.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:89](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L89)

Iteration index (from the LLMStartPayload).

***

### model

> `readonly` **model**: `string`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:93](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L93)

Model id.

***

### partial

> `readonly` **partial**: `string`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:85](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L85)

Accumulated content from `stream.token` events since `llm_start`.

***

### provider

> `readonly` **provider**: `string`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:91](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L91)

Provider name (e.g., 'anthropic', 'openai').

***

### startedAtMs

> `readonly` **startedAtMs**: `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:95](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L95)

Wall-clock ms when llm_start fired.

***

### tokens

> `readonly` **tokens**: `number`

Defined in: [src/recorders/observability/LiveStateRecorder.ts:87](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LiveStateRecorder.ts#L87)

Number of tokens received so far.
