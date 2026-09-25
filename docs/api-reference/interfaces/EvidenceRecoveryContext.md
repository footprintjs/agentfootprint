[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EvidenceRecoveryContext

# Interface: EvidenceRecoveryContext

Defined in: [src/core/agent/evidence/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L56)

Typed, detached context for the ONE internal evidence-recovery request.
This is a token-grounding finding, not a semantic truth judgement.

## Properties

### attempt

> `readonly` **attempt**: `1`

Defined in: [src/core/agent/evidence/types.ts:58](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L58)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/evidence/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L59)

***

### kind

> `readonly` **kind**: `"evidence"`

Defined in: [src/core/agent/evidence/types.ts:57](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L57)

***

### originalRequest

> `readonly` **originalRequest**: `string`

Defined in: [src/core/agent/evidence/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L61)

The authoritative input to this run, not an internally authored turn.

***

### rejectedDraft

> `readonly` **rejectedDraft**: `string`

Defined in: [src/core/agent/evidence/types.ts:62](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L62)

***

### spenderTools?

> `readonly` `optional` **spenderTools?**: readonly `string`[]

Defined in: [src/core/agent/evidence/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L65)

***

### stagedRefs?

> `readonly` `optional` **stagedRefs?**: readonly `object`[]

Defined in: [src/core/agent/evidence/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L64)

***

### unsupported

> `readonly` **unsupported**: readonly [`UnsupportedValue`](/agentfootprint/api/generated/interfaces/UnsupportedValue.md)[]

Defined in: [src/core/agent/evidence/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L63)
