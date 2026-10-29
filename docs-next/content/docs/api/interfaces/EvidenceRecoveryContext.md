---
title: EvidenceRecoveryContext
---

# Interface: EvidenceRecoveryContext

Defined in: [src/core/agent/evidence/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L57)

Typed, detached context for the ONE internal evidence-recovery request.
This is a token-grounding finding, not a semantic truth judgement.

## Properties

### attempt

> `readonly` **attempt**: `1`

Defined in: [src/core/agent/evidence/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L59)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/evidence/types.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L60)

***

### kind

> `readonly` **kind**: `"evidence"`

Defined in: [src/core/agent/evidence/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L58)

***

### originalRequest

> `readonly` **originalRequest**: `string`

Defined in: [src/core/agent/evidence/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L62)

The authoritative input to this run, not an internally authored turn.

***

### rejectedDraft

> `readonly` **rejectedDraft**: `string`

Defined in: [src/core/agent/evidence/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L63)

***

### spenderTools?

> `readonly` `optional` **spenderTools?**: readonly `string`[]

Defined in: [src/core/agent/evidence/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L66)

***

### stagedRefs?

> `readonly` `optional` **stagedRefs?**: readonly `object`[]

Defined in: [src/core/agent/evidence/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L65)

***

### unsupported

> `readonly` **unsupported**: readonly [`UnsupportedValue`](/docs/api/interfaces/UnsupportedValue)[]

Defined in: [src/core/agent/evidence/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L64)
