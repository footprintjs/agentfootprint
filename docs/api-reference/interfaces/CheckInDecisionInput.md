[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInDecisionInput

# Interface: CheckInDecisionInput

Defined in: [src/core/checkin.ts:191](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L191)

Options for [checkInApproved](/agentfootprint/api/generated/functions/checkInApproved.md) / [checkInDeclined](/agentfootprint/api/generated/functions/checkInDeclined.md).

## Properties

### by

> `readonly` **by**: `string`

Defined in: [src/core/checkin.ts:193](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L193)

Who decided.

***

### note?

> `readonly` `optional` **note?**: `string`

Defined in: [src/core/checkin.ts:195](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L195)

Optional free-text note.

***

### value?

> `readonly` `optional` **value?**: [`DecisionValue`](/agentfootprint/api/generated/interfaces/DecisionValue.md)

Defined in: [src/core/checkin.ts:197](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L197)

What was chosen, for an ask that wanted a value rather than a yes.
