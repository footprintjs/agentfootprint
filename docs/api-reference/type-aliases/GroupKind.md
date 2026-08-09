[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / GroupKind

# Type Alias: GroupKind

> **GroupKind** = `"Parallel"` \| `"Sequence"` \| `"Loop"` \| `"Conditional"` \| `"Agent"` \| `"LLMCall"`

Defined in: [src/core/translator.ts:39](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/translator.ts#L39)

The composition KIND a translator sees in `GroupMetadata.kind`.
Closed union — every agentfootprint composition declares exactly
one of these via the literal string baked into its `buildChart()`
description prefix and surfaced here in `GroupMetadata`.
