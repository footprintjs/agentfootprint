[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / selfConsistency

# Function: selfConsistency()

> **selfConsistency**(`opts`): [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/SelfConsistency.ts:46](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/patterns/SelfConsistency.ts#L46)

Build a SelfConsistency Runner. Given a system prompt, the Runner
runs `samples` parallel LLMCalls with the same input, extracts each
response's vote token, then returns the most-frequent token. Ties
are broken by the first response's extract.

## Parameters

### opts

[`SelfConsistencyOptions`](/agentfootprint/api/generated/interfaces/SelfConsistencyOptions.md)

## Returns

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>
