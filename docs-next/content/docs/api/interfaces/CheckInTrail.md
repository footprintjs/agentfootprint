---
title: CheckInTrail
---

# Interface: CheckInTrail

Defined in: [src/core/checkin.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L124)

A compact grouped summary of the run so far.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L126)

Which ReAct iteration this check-in fired on.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:130](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L130)

One-line human summary, e.g. `"3 tools run over 2 iterations"`.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/core/checkin.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L128)

The tool calls already completed this run, oldest first.
