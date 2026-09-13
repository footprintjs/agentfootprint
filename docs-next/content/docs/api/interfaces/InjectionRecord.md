---
title: InjectionRecord
---

# Interface: InjectionRecord

Defined in: src/recorders/core/types.ts:24

An injection record written by a slot subflow into `scope[INJECTION_KEYS[slot]]`.
ContextRecorder reads this to construct the corresponding event payload.

Builders write arrays of these; recorders diff old-vs-new to detect NEW
injections.

## Properties

### asRecency?

> `readonly` `optional` **asRecency?**: `ContextRecency`

Defined in: src/recorders/core/types.ts:44

Recency, when injecting into messages slot.

***

### asRole?

> `readonly` `optional` **asRole?**: `ContextRole`

Defined in: src/recorders/core/types.ts:42

Role, when injecting into messages slot.

***

### budgetSpent?

> `readonly` `optional` **budgetSpent?**: `object`

Defined in: src/recorders/core/types.ts:53

#### fractionOfCap

> `readonly` **fractionOfCap**: `number`

#### tokens

> `readonly` **tokens**: `number`

***

### contentHash

> `readonly` **contentHash**: `string`

Defined in: src/recorders/core/types.ts:30

Stable hash of the content — enables duplicate detection.

***

### contentSummary

> `readonly` **contentSummary**: `string`

Defined in: src/recorders/core/types.ts:26

Short human-readable content summary.

***

### expiresAfter?

> `readonly` `optional` **expiresAfter?**: `ContextLifetime`

Defined in: src/recorders/core/types.ts:55

How long this injection is expected to persist.

***

### position?

> `readonly` `optional` **position?**: `number`

Defined in: src/recorders/core/types.ts:46

Position within the slot (messages index, system-prompt section order).

***

### rankPosition?

> `readonly` `optional` **rankPosition?**: `number`

Defined in: src/recorders/core/types.ts:51

***

### rawContent?

> `readonly` `optional` **rawContent?**: `string`

Defined in: src/recorders/core/types.ts:28

Full content (may be redacted downstream). Optional.

***

### reason

> `readonly` **reason**: `string`

Defined in: src/recorders/core/types.ts:40

Why this was injected.

***

### retrievalScore?

> `readonly` `optional` **retrievalScore?**: `number`

Defined in: src/recorders/core/types.ts:50

Retrieval / ranking evidence.

***

### sectionTag?

> `readonly` `optional` **sectionTag?**: `string`

Defined in: src/recorders/core/types.ts:48

Section tag for structured system prompts (e.g. "<skill>", "<retrieved>").

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: src/recorders/core/types.ts:32

The 3-slot target (sanity-checked against the subflow ID).

***

### source

> `readonly` **source**: `ContextSource`

Defined in: src/recorders/core/types.ts:34

Where this content came from.

***

### sourceId?

> `readonly` `optional` **sourceId?**: `string`

Defined in: src/recorders/core/types.ts:36

Optional source-specific identifier (retriever id, skill id, ...).

***

### threshold?

> `readonly` `optional` **threshold?**: `number`

Defined in: src/recorders/core/types.ts:52

***

### upstreamRef?

> `readonly` `optional` **upstreamRef?**: `string`

Defined in: src/recorders/core/types.ts:38

Upstream event reference (runtimeStageId that produced the content).
