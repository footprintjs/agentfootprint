---
title: inMemoryDecisionLedger
---

# Function: inMemoryDecisionLedger()

> **inMemoryDecisionLedger**(): [`DecisionLedger`](/docs/api/interfaces/DecisionLedger)

Defined in: [src/core/consentRequest.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L230)

A NEW [DecisionLedger](/docs/api/interfaces/DecisionLedger) in this process's memory. Grows by one id per
answered request.

Agents that name no ledger already share one of these per process, so this
is for a ledger of their own: agents given different ledgers spend
separately, and a decision spent in one is not known to the others.

## Returns

[`DecisionLedger`](/docs/api/interfaces/DecisionLedger)
