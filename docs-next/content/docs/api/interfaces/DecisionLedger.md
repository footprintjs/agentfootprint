---
title: DecisionLedger
---

# Interface: DecisionLedger

Defined in: src/core/consentRequest.ts:114

Where an agent records the consent requests that have been answered, so one
decision runs one call.

The default ([inMemoryDecisionLedger](/docs/api/functions/inMemoryDecisionLedger)) is per agent and per process.
Pass one shared store when a paused run can be resumed by more than one
agent instance — a server that builds an agent per request, or resumes a
stored checkpoint in another process.

## Methods

### spend()

> **spend**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: src/core/consentRequest.ts:122

Record `requestId` as answered. Resolve `true` when THIS call recorded it
and `false` when it was already recorded — atomically per id: of two
concurrent calls for one id, exactly one may see `true`. Anything other
than `true` refuses the decision; a throw fails the resume. Both fail
closed: the tool does not run.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>
