[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ENGINEERED\_SOURCES

# Variable: ENGINEERED\_SOURCES

> `const` **ENGINEERED\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:67](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/recorders/core/contextEngineering.ts#L67)

Public set of "engineered" sources — the context-engineering
primitives that consumers configure (RAG, Skills, Memory,
Instructions, Steering, Facts) plus user-defined `custom`.

Frozen so consumers can `.has(value)` directly without copy.
