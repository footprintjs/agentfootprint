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

### storeId?

> `readonly` `optional` **storeId?**: `string`

Defined in: [src/core/consentRequest.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L190)

OPTIONAL — the identity of the store this ledger records into. A host that
closes a pause no answer can reach asks the ledger the pause was minted
under — and only that one — to prove its call never ran
([DecisionLedger.spend](/docs/api/interfaces/DecisionLedger#spend)); a ledger without a `storeId` never proves,
and the call is recorded as possibly run.

The contract this library cannot check, and that the proof rests on:

 - unique per BACKING STORE: one value for one table (or collection, or
   key space) and every process that writes it — never copied from
   staging to production, never shared by per-tenant tables;
 - permanent: the same for the life of that store;
 - changed on any migration to a new store — a request spent in the old
   store is not in the new one, and must not be read as never spent there.
   Pending approvals are then asked again: a decision is spent only in the
   ledger its request was asked under (`'ledger-changed'`).

Spends in it are permanent too (no expiry) — see `spend`.

## Methods

### isSpent()?

> `optional` **isSpent**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:219](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L219)

OPTIONAL — whether `requestId` is recorded as answered, without recording
it. Asked only after a [DecisionLedger.spend](/docs/api/interfaces/DecisionLedger#spend) for it failed, so a
host can tell a spend that never landed (the call did not run; the pause
stays answerable) from one that did. A ledger without it, or one that
throws or answers anything but `false`, counts as spent: the host stops
offering the pause. Asked, too, whether a host recorded closing a request
(`closed-proven:<requestId>`) — so a retried close keeps the verdict the
first one proved, and a person whose answer arrives after the close is
told the host closed it. Never asked whether the REQUEST is unspent as a
proof that its call did not run: a read can be overtaken by a resume
elsewhere; only `spend` proves.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### spend()

> **spend**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L205)

Record `requestId` as answered. Resolve `true` when THIS call recorded it
and `false` when it was already recorded — atomically per id: of two
concurrent calls for one id, exactly one may see `true`. Anything other
than `true` refuses the decision; a throw fails the resume. Both fail
closed: the tool does not run.

A recorded id stays recorded: for a ledger that is to prove a paused call
never ran (one with a [DecisionLedger.storeId](/docs/api/interfaces/DecisionLedger#storeid)), the result is
permanent — no expiry. A host closing a pause spends its request here as
the proof (`true`: no decision had reached it, and none ever can), then
`closed-proven:<requestId>` to record that IT closed it; a key that expired
would let a spent request read as never spent.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>
