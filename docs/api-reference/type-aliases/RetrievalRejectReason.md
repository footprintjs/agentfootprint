[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalRejectReason

# Type Alias: RetrievalRejectReason

> **RetrievalRejectReason** = `"below-threshold"` \| `"over-budget"` \| `"over-max-entries"` \| `"over-char-budget"`

Defined in: [src/memory/retrieval/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/b523c2fedb76df5519470c43583559bfaafdfff4/src/memory/retrieval/types.ts#L30)

Why a candidate did not reach the prompt. Every rejected candidate
names one of these — a rejection without a reason is the silence this
whole record exists to remove.
