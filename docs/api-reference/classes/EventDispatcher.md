[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EventDispatcher

# Class: EventDispatcher

Defined in: [src/events/dispatcher.ts:97](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L97)

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

Defined in: [src/events/dispatcher.ts:200](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L200)

Route an event to all matching listeners (typed + domain-wildcard + all).

Fire-and-forget: any returned Promise is IGNORED. Listener exceptions
are caught and re-dispatched as `error.fatal` events with scope='observer'.
The run continues regardless.

#### Parameters

##### event

[`AgentfootprintEvent`](/agentfootprint/api/generated/type-aliases/AgentfootprintEvent.md)

#### Returns

`void`

***

### hasListenersFor()

> **hasListenersFor**(`type`): `boolean`

Defined in: [src/events/dispatcher.ts:108](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L108)

Fast-path check. Returns true when at least one listener would fire
for this type. Used by emitters to skip event-object allocation.

#### Parameters

##### type

keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

#### Returns

`boolean`

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/events/dispatcher.ts:176](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L176)

Remove a specific listener for a type. Prefer AbortSignal for auto-cleanup.

Because listeners are wrapped in dev mode, identity is preserved via a
WeakMap in addListener — consumers pass the original function.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/agentfootprint/api/generated/type-aliases/EventListener.md)\<`K`\>

##### Returns

`void`

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/events/dispatcher.ts:177](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L177)

Remove a specific listener for a type. Prefer AbortSignal for auto-cleanup.

Because listeners are wrapped in dev mode, identity is preserved via a
WeakMap in addListener — consumers pass the original function.

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

##### Returns

`void`

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/events/dispatcher.ts:125](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L125)

Subscribe a typed listener for a specific event type.

The listener signature is `(event) => void` by design — Promises are
NOT awaited. See dispatch() for details.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/agentfootprint/api/generated/type-aliases/EventListener.md)\<`K`\>

###### options?

[`ListenOptions`](/agentfootprint/api/generated/interfaces/ListenOptions.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

#### Call Signature

> **on**(`type`, `listener`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/events/dispatcher.ts:131](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L131)

Subscribe to a domain wildcard ('agentfootprint.context.*') or '*'.

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

###### options?

[`ListenOptions`](/agentfootprint/api/generated/interfaces/ListenOptions.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/events/dispatcher.ts:160](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L160)

Subscribe a one-shot listener. Fires at most once and then auto-removes.
Equivalent to `on(type, listener, { once: true })`.

##### Type Parameters

###### K

`K` *extends* keyof [`AgentfootprintEventMap`](/agentfootprint/api/generated/interfaces/AgentfootprintEventMap.md)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/agentfootprint/api/generated/type-aliases/EventListener.md)\<`K`\>

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

#### Call Signature

> **once**(`type`, `listener`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/events/dispatcher.ts:161](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/dispatcher.ts#L161)

Subscribe a one-shot listener. Fires at most once and then auto-removes.
Equivalent to `on(type, listener, { once: true })`.

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
