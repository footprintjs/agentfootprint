[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupKind

# Type Alias: GroupKind

> **GroupKind** = `"Parallel"` \| `"Sequence"` \| `"Loop"` \| `"Conditional"` \| `"Agent"` \| `"LLMCall"`

Defined in: [src/core/translator.ts:39](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/translator.ts#L39)

The composition KIND a translator sees in `GroupMetadata.kind`.
Closed union — every agentfootprint composition declares exactly
one of these via the literal string baked into its `buildChart()`
description prefix and surfaced here in `GroupMetadata`.
