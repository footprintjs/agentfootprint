[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RetrievalRejectReason

# Type Alias: RetrievalRejectReason

> **RetrievalRejectReason** = `"below-threshold"` \| `"over-budget"` \| `"over-max-entries"` \| `"over-char-budget"`

Defined in: [src/memory/retrieval/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/52c477b2ecd2d7726225ffb62f954a70f5d77804/src/memory/retrieval/types.ts#L30)

Why a candidate did not reach the prompt. Every rejected candidate
names one of these — a rejection without a reason is the silence this
whole record exists to remove.
