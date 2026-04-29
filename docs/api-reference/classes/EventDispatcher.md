[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / EventDispatcher

# Class: EventDispatcher

Defined in: [agentfootprint/src/events/dispatcher.ts:93](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L93)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:196](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L196)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:104](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L104)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:172](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L172)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:173](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L173)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:121](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L121)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:127](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L127)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:156](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L156)

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

Defined in: [agentfootprint/src/events/dispatcher.ts:157](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/dispatcher.ts#L157)

Subscribe a one-shot listener. Fires at most once and then auto-removes.
Equivalent to `on(type, listener, { once: true })`.

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)
