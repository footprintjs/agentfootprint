[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInTrail

# Interface: CheckInTrail

Defined in: [src/core/checkin.ts:107](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L107)

A compact grouped summary of the run so far.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:109](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L109)

Which ReAct iteration this check-in fired on.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:113](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L113)

One-line human summary, e.g. `"3 tools run over 2 iterations"`.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/core/checkin.ts:111](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/checkin.ts#L111)

The tool calls already completed this run, oldest first.
