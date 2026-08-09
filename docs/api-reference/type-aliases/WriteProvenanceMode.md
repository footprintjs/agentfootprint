[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WriteProvenanceMode

# Type Alias: WriteProvenanceMode

> **WriteProvenanceMode** = `NonNullable`\<`FlowChartExecutorOptions`\[`"writeProvenance"`\]\>

Defined in: [src/core/agent/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core/agent/types.ts#L59)

Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
structurally from footprintjs's executor options (the engine owns the
vocabulary; it does not export the alias), so the two can never drift.
