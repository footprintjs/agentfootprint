---
title: DecisionLedger
---

# Interface: DecisionLedger

Defined in: [src/core/consentRequest.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L133)

Where the consent requests that have been answered are recorded, so one
decision runs one call — once per LEDGER.

By default every agent that names none spends in one ledger in this
process's memory: "once" holds across this process's agents — a pool that
rebuilds an evicted instance, a server that builds an agent per request —
and only there. A restart forgets it, and another process never saw it.
When more than one process can resume the same paused run, or a restart
must not forget, give every agent that can resume it one ledger backed by a
store they all reach (`Agent.create({ decisionLedger })`).

## Methods

### spend()

> **spend**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:141](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L141)

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
