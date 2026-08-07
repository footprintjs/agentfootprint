[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WriteProvenanceMode

# Type Alias: WriteProvenanceMode

> **WriteProvenanceMode** = `NonNullable`\<`FlowChartExecutorOptions`\[`"writeProvenance"`\]\>

Defined in: [src/core/agent/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/core/agent/types.ts#L58)

Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
structurally from footprintjs's executor options (the engine owns the
vocabulary; it does not export the alias), so the two can never drift.
