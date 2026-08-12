[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WireRole

# Type Alias: WireRole

> **WireRole** = `"system"` \| `"user"` \| `"assistant"`

Defined in: [src/adapters/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/adapters/types.ts#L123)

The roles a provider can carry INSIDE the `messages` array.

`'tool'` is deliberately absent: a tool message is an answer to a specific
`tool_use` id, so it cannot be authored by an injection — there is no call
for it to answer. See `LLMProvider.carriesInMessages`.
