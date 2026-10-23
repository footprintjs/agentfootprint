---
title: DecisionLedger
---

# Interface: DecisionLedger

Defined in: [src/core/consentRequest.ts:169](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L169)

Where the consent requests that have been answered are recorded, so one
decision runs one call — once per LEDGER.

By default every agent that names none spends in one ledger in this
process's memory: "once" holds across this process's agents — a pool that
rebuilds an evicted instance, a server that builds an agent per request —
and only there. A restart forgets it, and another process never saw it.
When more than one process can resume the same paused run, or a restart
must not forget, give every agent that can resume it one ledger backed by a
store they all reach (`Agent.create({ decisionLedger })`).

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core/consentRequest.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L178)

OPTIONAL — a stable name for this ledger: the same in every process that
shares it, and never given to another ledger (a table name, say). A host
that closes a pause no answer can reach asks the ledger the pause was
minted under — and only that one — whether its call can have run
([DecisionLedger.spend](/docs/api/interfaces/DecisionLedger#spend)); without an `id` a ledger is never asked,
and the call's outcome is recorded as not known.

## Methods

### isSpent()?

> `optional` **isSpent**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:202](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L202)

OPTIONAL — whether `requestId` is recorded as answered, without recording
it. Asked only after a [DecisionLedger.spend](/docs/api/interfaces/DecisionLedger#spend) for it failed, so a
host can tell a spend that never landed (the call did not run; the pause
stays answerable) from one that did. A ledger without it, or one that
throws or answers anything but `false`, counts as spent: the host stops
offering the pause. Never asked for a proof that a call did not run —
a read can be overtaken by a resume elsewhere; only `spend` proves.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### spend()

> **spend**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L192)

Record `requestId` as answered. Resolve `true` when THIS call recorded it
and `false` when it was already recorded — atomically per id: of two
concurrent calls for one id, exactly one may see `true`. Anything other
than `true` refuses the decision; a throw fails the resume. Both fail
closed: the tool does not run.

A recorded id stays recorded: for a ledger that is to prove a paused call
never ran (one with an [DecisionLedger.id](/docs/api/interfaces/DecisionLedger#id)), the result is permanent
— no expiry. A host closing a pause spends its request here as the proof
(`true`: no decision had reached it, and none ever can); a key that
expired would let a spent request read as never spent.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>
