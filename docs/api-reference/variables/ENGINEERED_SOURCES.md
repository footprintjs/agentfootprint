[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ENGINEERED\_SOURCES

# Variable: ENGINEERED\_SOURCES

> `const` **ENGINEERED\_SOURCES**: `ReadonlySet`\<[`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md)\>

Defined in: [src/recorders/core/contextEngineering.ts:67](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/core/contextEngineering.ts#L67)

Public set of "engineered" sources — the context-engineering
primitives that consumers configure (RAG, Skills, Memory,
Instructions, Steering, Facts) plus user-defined `custom`.

Frozen so consumers can `.has(value)` directly without copy.
