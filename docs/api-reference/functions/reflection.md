[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / reflection

# Function: reflection()

> **reflection**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Reflection.ts:55](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/patterns/Reflection.ts#L55)

Build a Reflection Runner. Each iteration:
  1. Propose — LLMCall writes a candidate answer based on the input
  2. Critique — LLMCall judges the candidate; exit marker stops loop
  3. Revise — next iteration's propose sees the previous critique

Each iteration's output (the candidate proposal) becomes the next
iteration's input. The final iteration's proposal is returned.

## Parameters

### opts

[`ReflectionOptions`](/agentfootprint/api/generated/interfaces/ReflectionOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
