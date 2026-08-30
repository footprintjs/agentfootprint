---
title: absenceSignalOf
---

# Function: absenceSignalOf()

> **absenceSignalOf**(`err`): [`RunbookAbsenceSignal`](/docs/api/classes/RunbookAbsenceSignal) \| `undefined`

Defined in: [src/core/runbook/dispatch.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/dispatch.ts#L58)

Recognize the signal on an error OR anywhere down its `cause` chain — an
 engine layer that wraps the stage's throw must not defeat the pass-through.

## Parameters

### err

`unknown`

## Returns

[`RunbookAbsenceSignal`](/docs/api/classes/RunbookAbsenceSignal) \| `undefined`
