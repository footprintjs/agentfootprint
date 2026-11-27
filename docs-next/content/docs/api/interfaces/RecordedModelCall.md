---
title: RecordedModelCall
---

# Interface: RecordedModelCall

Defined in: [src/time-travel/servedInvocation.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L27)

An exact model call position in the original native invocation log.

## Properties

### commitIdx

> `readonly` **commitIdx**: `number`

Defined in: [src/time-travel/servedInvocation.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L33)

The zero-based position in the original full local log, including any mapper commit.

***

### engineRunId

> `readonly` **engineRunId**: `string`

Defined in: [src/time-travel/servedInvocation.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L28)

***

### invocationPath

> `readonly` **invocationPath**: readonly `string`[]

Defined in: [src/time-travel/servedInvocation.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L31)

The opened recording's relative mount path, outermost first.

***

### logRunId

> `readonly` **logRunId**: `string`

Defined in: [src/time-travel/servedInvocation.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L29)

***

### runtimeStageId

> `readonly` **runtimeStageId**: `string`

Defined in: [src/time-travel/servedInvocation.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/time-travel/servedInvocation.ts#L34)
