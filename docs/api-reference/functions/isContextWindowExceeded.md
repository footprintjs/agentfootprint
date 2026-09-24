[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isContextWindowExceeded

# Function: isContextWindowExceeded()

> **isContextWindowExceeded**(`err`): `err is ContextWindowExceededError`

Defined in: [src/adapters/llm/contextWindow.ts:96](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/llm/contextWindow.ts#L96)

`true` for the typed error, including across a `structuredClone`-free
 boundary where `instanceof` still holds. Kept as a function so callers do
 not have to import the class to ask the question.

## Parameters

### err

`unknown`

## Returns

`err is ContextWindowExceededError`
