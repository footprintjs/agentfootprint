[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / InjectionRecord

# Interface: InjectionRecord

Defined in: [agentfootprint/src/recorders/core/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L24)

An injection record written by a slot subflow into `scope[INJECTION_KEYS[slot]]`.
ContextRecorder reads this to construct the corresponding event payload.

Builders write arrays of these; recorders diff old-vs-new to detect NEW
injections.

## Properties

### asRecency?

> `readonly` `optional` **asRecency?**: [`ContextRecency`](/agentfootprint/api/generated/type-aliases/ContextRecency.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:44](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L44)

Recency, when injecting into messages slot.

***

### asRole?

> `readonly` `optional` **asRole?**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L42)

Role, when injecting into messages slot.

***

### budgetSpent?

> `readonly` `optional` **budgetSpent?**: `object`

Defined in: [agentfootprint/src/recorders/core/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L53)

#### fractionOfCap

> `readonly` **fractionOfCap**: `number`

#### tokens

> `readonly` **tokens**: `number`

***

### contentHash

> `readonly` **contentHash**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L30)

Stable hash of the content — enables duplicate detection.

***

### contentSummary

> `readonly` **contentSummary**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L26)

Short human-readable content summary.

***

### expiresAfter?

> `readonly` `optional` **expiresAfter?**: [`ContextLifetime`](/agentfootprint/api/generated/type-aliases/ContextLifetime.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L55)

How long this injection is expected to persist.

***

### position?

> `readonly` `optional` **position?**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L46)

Position within the slot (messages index, system-prompt section order).

***

### rankPosition?

> `readonly` `optional` **rankPosition?**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L51)

***

### rawContent?

> `readonly` `optional` **rawContent?**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L28)

Full content (may be redacted downstream). Optional.

***

### reason

> `readonly` **reason**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L40)

Why this was injected.

***

### retrievalScore?

> `readonly` `optional` **retrievalScore?**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L50)

Retrieval / ranking evidence.

***

### sectionTag?

> `readonly` `optional` **sectionTag?**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L48)

Section tag for structured system prompts (e.g. "<skill>", "<retrieved>").

***

### slot

> `readonly` **slot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L32)

The 3-slot target (sanity-checked against the subflow ID).

***

### source

> `readonly` **source**: [`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L34)

Where this content came from.

***

### sourceId?

> `readonly` `optional` **sourceId?**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L36)

Optional source-specific identifier (retriever id, skill id, ...).

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L52)

***

### upstreamRef?

> `readonly` `optional` **upstreamRef?**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L38)

Upstream event reference (runtimeStageId that produced the content).
