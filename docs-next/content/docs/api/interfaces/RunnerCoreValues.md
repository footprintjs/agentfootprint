---
title: RunnerCoreValues
---

# Interface: RunnerCoreValues

Defined in: [src/core/runnerCoreValues.ts:8](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L8)

## Properties

### parentIdentity?

> `optional` **parentIdentity?**: `MemoryIdentity`

Defined in: [src/core/runnerCoreValues.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L14)

***

### parentRequest?

> `optional` **parentRequest?**: `RequestContext`

Defined in: [src/core/runnerCoreValues.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L15)

***

### parentRun?

> `optional` **parentRun?**: `ParentRunRecord`

Defined in: [src/core/runnerCoreValues.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L16)

***

### privateFields?

> `optional` **privateFields?**: `PrivateRecordFields`

Defined in: [src/core/runnerCoreValues.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L11)

***

### recordMarks?

> `optional` **recordMarks?**: [`RedactionPolicy`](/docs/api/interfaces/RedactionPolicy)

Defined in: [src/core/runnerCoreValues.ts:13](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L13)

Conservative native marks remain record-only, never caller-policy provenance.

***

### redaction?

> `optional` **redaction?**: `RunRedaction`

Defined in: [src/core/runnerCoreValues.ts:10](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerCoreValues.ts#L10)

Private policy/serving for this execution; never tracked chart state.
