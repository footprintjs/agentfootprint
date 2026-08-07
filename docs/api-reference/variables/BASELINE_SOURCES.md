[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BASELINE\_SOURCES

# Variable: BASELINE\_SOURCES

> `const` **BASELINE\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:83](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/recorders/core/contextEngineering.ts#L83)

Public set of "baseline" sources — the message-history flow that
exists regardless of context engineering: user input, tool results,
assistant outputs, the always-on system prompt anchor (`base`), and
the agent's static tool registry advertisement (`registry`).
