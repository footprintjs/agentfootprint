[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BASELINE\_SOURCES

# Variable: BASELINE\_SOURCES

> `const` **BASELINE\_SOURCES**: `ReadonlySet`\<[`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md)\>

Defined in: [src/recorders/core/contextEngineering.ts:83](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/core/contextEngineering.ts#L83)

Public set of "baseline" sources — the message-history flow that
exists regardless of context engineering: user input, tool results,
assistant outputs, the always-on system prompt anchor (`base`), and
the agent's static tool registry advertisement (`registry`).
