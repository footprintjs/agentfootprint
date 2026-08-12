[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / isContextWindowExceeded

# Function: isContextWindowExceeded()

> **isContextWindowExceeded**(`err`): `err is ContextWindowExceededError`

Defined in: [src/adapters/llm/contextWindow.ts:96](https://github.com/footprintjs/agentfootprint/blob/a076ce4729494fbee32b8a5fe7f46f567fa9fbe9/src/adapters/llm/contextWindow.ts#L96)

`true` for the typed error, including across a `structuredClone`-free
 boundary where `instanceof` still holds. Kept as a function so callers do
 not have to import the class to ask the question.

## Parameters

### err

`unknown`

## Returns

`err is ContextWindowExceededError`
