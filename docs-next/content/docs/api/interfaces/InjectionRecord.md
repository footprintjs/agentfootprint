---
title: InjectionRecord
---

# Interface: InjectionRecord

Defined in: [src/recorders/core/types.ts:25](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L25)

An injection record written by a slot subflow into `scope[INJECTION_KEYS[slot]]`.
ContextRecorder reads this to construct the corresponding event payload.

Builders write arrays of these; recorders diff old-vs-new to detect NEW
injections.

## Properties

### asRecency?

> `readonly` `optional` **asRecency?**: `ContextRecency`

Defined in: [src/recorders/core/types.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L47)

Recency, when injecting into messages slot.

***

### asRole?

> `readonly` `optional` **asRole?**: `ContextRole`

Defined in: [src/recorders/core/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L45)

Role, when injecting into messages slot.

***

### budgetSpent?

> `readonly` `optional` **budgetSpent?**: `object`

Defined in: [src/recorders/core/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L56)

#### fractionOfCap

> `readonly` **fractionOfCap**: `number`

#### tokens

> `readonly` **tokens**: `number`

***

### callOccurrenceKey?

> `readonly` `optional` **callOccurrenceKey?**: `CallOccurrenceKey`

Defined in: [src/recorders/core/types.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L39)

The recorded occurrence of a baseline tool result in the messages slot.

***

### contentHash

> `readonly` **contentHash**: `string`

Defined in: [src/recorders/core/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L31)

Stable hash of the content — enables duplicate detection.

***

### contentSummary

> `readonly` **contentSummary**: `string`

Defined in: [src/recorders/core/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L27)

Short human-readable content summary.

***

### expiresAfter?

> `readonly` `optional` **expiresAfter?**: `ContextLifetime`

Defined in: [src/recorders/core/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L58)

How long this injection is expected to persist.

***

### position?

> `readonly` `optional` **position?**: `number`

Defined in: [src/recorders/core/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L49)

Position within the slot (messages index, system-prompt section order).

***

### rankPosition?

> `readonly` `optional` **rankPosition?**: `number`

Defined in: [src/recorders/core/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L54)

***

### rawContent?

> `readonly` `optional` **rawContent?**: `string`

Defined in: [src/recorders/core/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L29)

Full content (may be redacted downstream). Optional.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/recorders/core/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L43)

Why this was injected.

***

### retrievalScore?

> `readonly` `optional` **retrievalScore?**: `number`

Defined in: [src/recorders/core/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L53)

Retrieval / ranking evidence.

***

### sectionTag?

> `readonly` `optional` **sectionTag?**: `string`

Defined in: [src/recorders/core/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L51)

Section tag for structured system prompts (e.g. "<skill>", "<retrieved>").

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L33)

The 3-slot target (sanity-checked against the subflow ID).

***

### source

> `readonly` **source**: `ContextSource`

Defined in: [src/recorders/core/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L35)

Where this content came from.

***

### sourceId?

> `readonly` `optional` **sourceId?**: `string`

Defined in: [src/recorders/core/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L37)

Optional source-specific identifier (retriever id, skill id, ...).

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: [src/recorders/core/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L55)

***

### upstreamRef?

> `readonly` `optional` **upstreamRef?**: `string`

Defined in: [src/recorders/core/types.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L41)

Upstream event reference (runtimeStageId that produced the content).
