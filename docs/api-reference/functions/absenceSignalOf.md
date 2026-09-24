[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / absenceSignalOf

# Function: absenceSignalOf()

> **absenceSignalOf**(`err`): [`RunbookAbsenceSignal`](/agentfootprint/api/generated/classes/RunbookAbsenceSignal.md) \| `undefined`

Defined in: [src/core/runbook/dispatch.ts:58](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/runbook/dispatch.ts#L58)

Recognize the signal on an error OR anywhere down its `cause` chain — an
 engine layer that wraps the stage's throw must not defeat the pass-through.

## Parameters

### err

`unknown`

## Returns

[`RunbookAbsenceSignal`](/agentfootprint/api/generated/classes/RunbookAbsenceSignal.md) \| `undefined`
