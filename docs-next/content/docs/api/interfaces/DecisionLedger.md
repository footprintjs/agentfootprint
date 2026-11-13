---
title: DecisionLedger
---

# Interface: DecisionLedger

Defined in: [src/core/consentRequest.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L176)

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

Defined in: [src/core/consentRequest.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L197)

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

Defined in: [src/core/consentRequest.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L225)

OPTIONAL advisory observation after a failed [DecisionLedger.spend](/docs/api/interfaces/DecisionLedger#spend).
`false` must mean this exact request is absent; `true` must mean it is
recorded. A throw, a bounded-out wait or any other answer is unknown.
Unknown counts as POSSIBLY used after an attempted spend, never as proof
of execution or non-execution. A cautious positive cannot refuse a fresh
answer or prove a host closed it: only the atomic spend is authority.
Library-created in-memory ledgers expose their actual Set membership
privately for synchronous replay refusal before native execution. An
opaque ledger goes straight to `spend`; its optional boolean is never
promoted into that definitive capability.

#### Parameters

##### requestId

`string`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### spend()

> **spend**(`requestId`): `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/core/consentRequest.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/consentRequest.ts#L212)

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
