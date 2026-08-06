[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ENGINEERED\_SOURCES

# Variable: ENGINEERED\_SOURCES

> `const` **ENGINEERED\_SOURCES**: `ReadonlySet`\<`ContextSource`\>

Defined in: [src/recorders/core/contextEngineering.ts:67](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/recorders/core/contextEngineering.ts#L67)

Public set of "engineered" sources — the context-engineering
primitives that consumers configure (RAG, Skills, Memory,
Instructions, Steering, Facts) plus user-defined `custom`.

Frozen so consumers can `.has(value)` directly without copy.
