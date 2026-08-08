[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / BASELINE\_SOURCES

# Variable: BASELINE\_SOURCES

> `const` **BASELINE\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:83](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/contextEngineering.ts#L83)

Public set of "baseline" sources — the message-history flow that
exists regardless of context engineering: user input, tool results,
assistant outputs, the always-on system prompt anchor (`base`), and
the agent's static tool registry advertisement (`registry`).
