[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BASELINE\_SOURCES

# Variable: BASELINE\_SOURCES

> `const` **BASELINE\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:83](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/recorders/core/contextEngineering.ts#L83)

Public set of "baseline" sources — the message-history flow that
exists regardless of context engineering: user input, tool results,
assistant outputs, the always-on system prompt anchor (`base`), and
the agent's static tool registry advertisement (`registry`).
