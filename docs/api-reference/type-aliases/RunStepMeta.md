[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunStepMeta

# Type Alias: RunStepMeta

> **RunStepMeta** = \{ `chosen`: `string`; `kind`: `"decide"`; `rationale?`: `string`; \} \| \{ `index`: `number`; `kind`: `"iteration"`; `target`: `string`; \} \| \{ `index`: `number`; `kind`: `"iteration-exit"`; `reason?`: `string`; \} \| \{ `kind`: `"fork"`; `parentSubflowId`: `string`; \} \| \{ `kind`: `"merge"`; `mergedCount`: `number`; \} \| \{ `actorArrow`: `"user→llm"` \| `"tool→llm"` \| `"llm→tool"` \| `"llm→user"`; `kind`: `"react"`; \}

Defined in: [src/recorders/observability/RunStepRecorder.ts:112](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/RunStepRecorder.ts#L112)
