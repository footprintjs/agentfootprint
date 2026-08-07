[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WriteProvenanceMode

# Type Alias: WriteProvenanceMode

> **WriteProvenanceMode** = `NonNullable`\<`FlowChartExecutorOptions`\[`"writeProvenance"`\]\>

Defined in: [src/core/agent/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/types.ts#L58)

Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
structurally from footprintjs's executor options (the engine owns the
vocabulary; it does not export the alias), so the two can never drift.
