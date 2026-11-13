---
title: CheckInTrail
---

# Interface: CheckInTrail

Defined in: [src/core/checkin.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L156)

A compact grouped summary of the run so far.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L158)

Which ReAct iteration this check-in fired on.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L162)

One-line human summary, e.g. `"3 tools run over 2 iterations"`.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/core/checkin.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L160)

The tool calls already completed this run, oldest first.
