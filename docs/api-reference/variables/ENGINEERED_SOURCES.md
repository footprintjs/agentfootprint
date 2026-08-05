[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ENGINEERED\_SOURCES

# Variable: ENGINEERED\_SOURCES

> `const` **ENGINEERED\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:67](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/recorders/core/contextEngineering.ts#L67)

Public set of "engineered" sources — the context-engineering
primitives that consumers configure (RAG, Skills, Memory,
Instructions, Steering, Facts) plus user-defined `custom`.

Frozen so consumers can `.has(value)` directly without copy.
