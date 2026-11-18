---
title: ChartToolObservability
---

# Type Alias: ChartToolObservability

> **ChartToolObservability** = `Readonly`\<`Pick`\<`RunDials`, `"readTracking"` \| `"writeTracking"` \| `"commitValues"` \| `"writeProvenance"`\>\>

Defined in: [src/core/chartToolObservability.ts:10](https://github.com/footprintjs/agentfootprint/blob/main/src/core/chartToolObservability.ts#L10)

Native inner-run observation dials shared by both chart-tool adapters.
Omitted fields keep the engine defaults. Summary read/write views retain
markers instead of values; full commit replay and privacy remain independent.
Write summaries also govern the native `onCommit` observation payload.
