---
title: WriteProvenanceMode
---

# Type Alias: WriteProvenanceMode

> **WriteProvenanceMode** = `NonNullable`\<`FlowChartExecutorOptions`\[`"writeProvenance"`\]\>

Defined in: [src/core/agent/types/observation.ts:21](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/types/observation.ts#L21)

Per-write read-provenance policy — `AgentOptions.writeProvenance`. Derived
structurally from footprintjs's executor options (the engine owns the
vocabulary; it does not export the alias), so the two can never drift.
