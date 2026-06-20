---
title: selfConsistency
---

# Function: selfConsistency()

> **selfConsistency**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/SelfConsistency.ts:46](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/patterns/SelfConsistency.ts#L46)

Build a SelfConsistency Runner. Given a system prompt, the Runner
runs `samples` parallel LLMCalls with the same input, extracts each
response's vote token, then returns the most-frequent token. Ties
are broken by the first response's extract.

## Parameters

### opts

[`SelfConsistencyOptions`](/docs/api/interfaces/SelfConsistencyOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
