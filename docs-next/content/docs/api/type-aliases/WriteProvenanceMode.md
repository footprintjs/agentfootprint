---
title: WriteProvenanceMode
---

# Type Alias: WriteProvenanceMode

> **WriteProvenanceMode** = `NonNullable`\<`FlowChartExecutorOptions`\[`"writeProvenance"`\]\>

Defined in: [src/core/agent/types/observation.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/observation.ts#L69)

Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
structurally from footprintjs's executor options (the engine owns the
vocabulary; it does not export the alias), so the two can never drift.
