---
title: isCheckInDecision
---

# Function: isCheckInDecision()

> **isCheckInDecision**(`x`): `x is CheckInDecision`

Defined in: [src/core/checkin.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L302)

Type guard — is this resume input a [CheckInDecision](/docs/api/interfaces/CheckInDecision)? Distinguishes
a check-in answer from a plain `askHuman` tool-result value. A decision
names its request: an object without a `requestId` is not one.

## Parameters

### x

`unknown`

## Returns

`x is CheckInDecision`
