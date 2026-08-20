[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WireRole

# Type Alias: WireRole

> **WireRole** = `"system"` \| `"user"` \| `"assistant"`

Defined in: [src/adapters/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/adapters/types.ts#L130)

The roles a provider can carry INSIDE the `messages` array.

`'tool'` is deliberately absent: a tool message is an answer to a specific
`tool_use` id, so it cannot be authored by an injection — there is no call
for it to answer. See `LLMProvider.carriesInMessages`.
