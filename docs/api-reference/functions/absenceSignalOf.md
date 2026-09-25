[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / absenceSignalOf

# Function: absenceSignalOf()

> **absenceSignalOf**(`err`): [`RunbookAbsenceSignal`](/agentfootprint/api/generated/classes/RunbookAbsenceSignal.md) \| `undefined`

Defined in: [src/core/runbook/dispatch.ts:58](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/runbook/dispatch.ts#L58)

Recognize the signal on an error OR anywhere down its `cause` chain — an
 engine layer that wraps the stage's throw must not defeat the pass-through.

## Parameters

### err

`unknown`

## Returns

[`RunbookAbsenceSignal`](/agentfootprint/api/generated/classes/RunbookAbsenceSignal.md) \| `undefined`
