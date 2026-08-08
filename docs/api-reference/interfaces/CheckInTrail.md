[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInTrail

# Interface: CheckInTrail

Defined in: [src/core/checkin.ts:96](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/checkin.ts#L96)

A compact grouped summary of the run so far.

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/checkin.ts:98](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/checkin.ts#L98)

Which ReAct iteration this check-in fired on.

***

### summary

> `readonly` **summary**: `string`

Defined in: [src/core/checkin.ts:102](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/checkin.ts#L102)

One-line human summary, e.g. `"3 tools run over 2 iterations"`.

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [src/core/checkin.ts:100](https://github.com/footprintjs/agentfootprint/blob/b9e290c7bd4b5b5f1c3ca077b90e9cc6fbd1bbcd/src/core/checkin.ts#L100)

The tool calls already completed this run, oldest first.
