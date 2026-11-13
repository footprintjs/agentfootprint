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

Defined in: [src/core/checkin.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L135)

One-line human summary, e.g. `"3 tool calls over 2 iterations"`. It counts
CALLS, never runs: the history this is built from does not say whether a
call's tool ran (an unknown tool name or a refused call is a call too), so
the sentence an approver reads claims only what it can count.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/core/checkin.ts:128](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L128)

The tool calls already completed this run, oldest first.
