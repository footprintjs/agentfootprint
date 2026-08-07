[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupKind

# Type Alias: GroupKind

> **GroupKind** = `"Parallel"` \| `"Sequence"` \| `"Loop"` \| `"Conditional"` \| `"Agent"` \| `"LLMCall"`

Defined in: [src/core/translator.ts:39](https://github.com/footprintjs/agentfootprint/blob/b5df2fd7d693fd0ea98d64e321079f8b7da1e085/src/core/translator.ts#L39)

The composition KIND a translator sees in `GroupMetadata.kind`.
Closed union — every agentfootprint composition declares exactly
one of these via the literal string baked into its `buildChart()`
description prefix and surfaced here in `GroupMetadata`.
