[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalRejectReason

# Type Alias: RetrievalRejectReason

> **RetrievalRejectReason** = `"below-threshold"` \| `"over-budget"` \| `"over-max-entries"`

Defined in: [src/memory/retrieval/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/b7f4615ff6ee62d30980a77f38c0bd850f4995af/src/memory/retrieval/types.ts#L30)

Why a candidate did not reach the prompt. Every rejected candidate
names one of these — a rejection without a reason is the silence this
whole record exists to remove.
