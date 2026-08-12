[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WireRole

# Type Alias: WireRole

> **WireRole** = `"system"` \| `"user"` \| `"assistant"`

Defined in: [src/adapters/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/adapters/types.ts#L123)

The roles a provider can carry INSIDE the `messages` array.

`'tool'` is deliberately absent: a tool message is an answer to a specific
`tool_use` id, so it cannot be authored by an injection — there is no call
for it to answer. See `LLMProvider.carriesInMessages`.
