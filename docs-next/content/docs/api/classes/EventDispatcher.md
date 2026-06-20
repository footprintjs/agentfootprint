---
title: EventDispatcher
---

# Class: EventDispatcher

Defined in: [src/events/dispatcher.ts:121](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L121)

Central event bus. One per executable runner.

Zero-alloc fast path: if `hasListenersFor(type)` is false AND there are
no wildcards, `dispatch` returns immediately without iteration.

## Constructors

### Constructor

> **new EventDispatcher**(): `EventDispatcher`

#### Returns

`EventDispatcher`

## Methods

### dispatch()

> **dispatch**(`event`): `void`

Defined in: [src/events/dispatcher.ts:310](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L310)

Route an event to all matching listeners (typed + domain-wildcard + all).

Fire-and-forget: any returned Promise is IGNORED. Listener exceptions
are caught and re-dispatched as `error.fatal` events with scope='observer'.
The run continues regardless.

#### Parameters

##### event

[`AgentfootprintEvent`](/docs/api/type-aliases/AgentfootprintEvent)

#### Returns

`void`

***

### hasListenersFor()

> **hasListenersFor**(`type`): `boolean`

Defined in: [src/events/dispatcher.ts:132](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L132)

Fast-path check. Returns true when at least one listener would fire
for this type. Used by emitters to skip event-object allocation.

#### Parameters

##### type

keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

#### Returns

`boolean`

***

### listenerCount()

> **listenerCount**(`type?`): `number`

Defined in: [src/events/dispatcher.ts:289](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L289)

Diagnostic — how many listeners the dispatcher currently retains.

- `listenerCount()` — TOTAL across every bucket (typed + domain
  wildcards + `'*'`). The number long-lived consumers watch to verify
  per-run subscriptions are being released (leak detection).
- `listenerCount(type)` — listeners registered under that exact
  subscription key (`'agentfootprint.agent.turn_start'`,
  `'agentfootprint.context.*'`, or `'*'`). NOTE: counts the bucket
  only — a typed count does NOT include wildcard listeners that would
  also fire for that type. "Would anything fire?" is
  `hasListenersFor()`.

#### Parameters

##### type?

keyof AgentfootprintEventMap \| [`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

#### Returns

`number`

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/events/dispatcher.ts:236](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L236)

Remove a specific listener for a type. Prefer AbortSignal for auto-cleanup.

Because listeners are wrapped in dev mode, identity is preserved via a
WeakMap in addListener — consumers pass the original function.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/docs/api/type-aliases/EventListener)\<`K`\>

##### Returns

`void`

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/events/dispatcher.ts:237](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L237)

Remove a specific listener for a type. Prefer AbortSignal for auto-cleanup.

Because listeners are wrapped in dev mode, identity is preserved via a
WeakMap in addListener — consumers pass the original function.

##### Parameters

###### type

[`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

###### listener

[`WildcardListener`](/docs/api/type-aliases/WildcardListener)

##### Returns

`void`

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/events/dispatcher.ts:149](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L149)

Subscribe a typed listener for a specific event type.

The listener signature is `(event) => void` by design — Promises are
NOT awaited. See dispatch() for details.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/docs/api/type-aliases/EventListener)\<`K`\>

###### options?

[`ListenOptions`](/docs/api/interfaces/ListenOptions)

##### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

#### Call Signature

> **on**(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/events/dispatcher.ts:155](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L155)

Subscribe to a domain wildcard ('agentfootprint.context.*') or '*'.

##### Parameters

###### type

[`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

###### listener

[`WildcardListener`](/docs/api/type-aliases/WildcardListener)

###### options?

[`ListenOptions`](/docs/api/interfaces/ListenOptions)

##### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/events/dispatcher.ts:169](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L169)

Subscribe a one-shot listener. Fires at most once and then auto-removes.
Equivalent to `on(type, listener, { once: true })`. Accepts `{ signal }`
for AbortSignal auto-cleanup, same as `on()`.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/docs/api/type-aliases/EventListener)\<`K`\>

###### options?

`Omit`\<[`ListenOptions`](/docs/api/interfaces/ListenOptions), `"once"`\>

##### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

#### Call Signature

> **once**(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/events/dispatcher.ts:174](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L174)

Subscribe a one-shot listener. Fires at most once and then auto-removes.
Equivalent to `on(type, listener, { once: true })`. Accepts `{ signal }`
for AbortSignal auto-cleanup, same as `on()`.

##### Parameters

###### type

[`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

###### listener

[`WildcardListener`](/docs/api/type-aliases/WildcardListener)

###### options?

`Omit`\<[`ListenOptions`](/docs/api/interfaces/ListenOptions), `"once"`\>

##### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

***

### removeAllListeners()

> **removeAllListeners**(): `void`

Defined in: [src/events/dispatcher.ts:268](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/events/dispatcher.ts#L268)

Lifecycle escape hatch — drop EVERY listener (typed, domain-wildcard,
and `'*'`) in one call. For long-lived server consumers that reuse one
runner across many requests: when you can't thread an AbortSignal or
keep every Unsubscribe handle, call this between requests to guarantee
the dispatcher holds zero subscriptions.

Safe to call mid-dispatch: the bucket currently being iterated
finishes its already-taken snapshot (same semantics as `off()` during
dispatch), buckets the in-flight dispatch has NOT yet reached deliver
nothing (DOM-like "stop now"), and every SUBSEQUENT event sees no
listeners. Abort handlers registered on consumer AbortSignals via
`{ signal }` are detached too. Previously returned Unsubscribe
handles become harmless no-ops.

#### Returns

`void`
