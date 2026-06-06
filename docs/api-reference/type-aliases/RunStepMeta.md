[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunStepMeta

# Type Alias: RunStepMeta

> **RunStepMeta** = \{ `chosen`: `string`; `kind`: `"decide"`; `rationale?`: `string`; \} \| \{ `index`: `number`; `kind`: `"iteration"`; `target`: `string`; \} \| \{ `index`: `number`; `kind`: `"iteration-exit"`; `reason?`: `string`; \} \| \{ `kind`: `"fork"`; `parentSubflowId`: `string`; \} \| \{ `kind`: `"merge"`; `mergedCount`: `number`; \} \| \{ `actorArrow`: `"user→llm"` \| `"tool→llm"` \| `"llm→tool"` \| `"llm→user"`; `kind`: `"react"`; \}

Defined in: [src/recorders/observability/RunStepRecorder.ts:112](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/RunStepRecorder.ts#L112)
