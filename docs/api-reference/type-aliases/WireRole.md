[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WireRole

# Type Alias: WireRole

> **WireRole** = `"system"` \| `"user"` \| `"assistant"`

Defined in: [src/adapters/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/adapters/types.ts#L176)

The roles a provider can carry INSIDE the `messages` array.

`'tool'` is deliberately absent: a tool message is an answer to a specific
`tool_use` id, so it cannot be authored by an injection — there is no call
for it to answer. See `LLMProvider.carriesInMessages`.
