---
title: EvidenceRecoveryContext
---

# Interface: EvidenceRecoveryContext

Defined in: src/core/agent/evidence/types.ts:56

Typed, detached context for the ONE internal evidence-recovery request.
This is a token-grounding finding, not a semantic truth judgement.

## Properties

### attempt

> `readonly` **attempt**: `1`

Defined in: src/core/agent/evidence/types.ts:58

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/agent/evidence/types.ts:59

***

### kind

> `readonly` **kind**: `"evidence"`

Defined in: src/core/agent/evidence/types.ts:57

***

### originalRequest

> `readonly` **originalRequest**: `string`

Defined in: src/core/agent/evidence/types.ts:61

The authoritative input to this run, not an internally authored turn.

***

### rejectedDraft

> `readonly` **rejectedDraft**: `string`

Defined in: src/core/agent/evidence/types.ts:62

***

### spenderTools?

> `readonly` `optional` **spenderTools?**: readonly `string`[]

Defined in: src/core/agent/evidence/types.ts:65

***

### stagedRefs?

> `readonly` `optional` **stagedRefs?**: readonly `object`[]

Defined in: src/core/agent/evidence/types.ts:64

***

### unsupported

> `readonly` **unsupported**: readonly [`UnsupportedValue`](/docs/api/interfaces/UnsupportedValue)[]

Defined in: src/core/agent/evidence/types.ts:63
