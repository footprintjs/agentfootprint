[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMProvider

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:369](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L369)

## Properties

### carriesInMessages?

> `readonly` `optional` **carriesInMessages?**: readonly [`WireRole`](/agentfootprint/api/generated/type-aliases/WireRole.md)[]

Defined in: [src/adapters/types.ts:396](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L396)

v7.21 — which roles this provider carries INSIDE the `messages` array.

The wires disagree, and the disagreement is invisible from the outside:
the Anthropic-family adapters (Anthropic, Bedrock, Browser Anthropic) DROP
a `role: 'system'` message inside `messages` because system rides a
separate top-level field, while the OpenAI-family adapters carry it. So a
`slot: 'messages'` injection with `role: 'system'` would arrive on one
provider and vanish on another — and nothing in the recording would tell
the two apart. Declaring the capability is what lets the engine refuse at
run start instead, naming the provider and the roles it does carry.

Consulted at DELIVERY time by the agent's `Deliver` stage. A role that is
not listed is REFUSED, never silently re-roled: changing who appears to
speak is a meaning change the app must make, not the library.

**Optional, and absence is not "carries everything"** — a provider that
omits it is treated as `['user', 'assistant']`
([DEFAULT\_CARRIES\_IN\_MESSAGES](/agentfootprint/api/generated/variables/DEFAULT_CARRIES_IN_MESSAGES.md)), the floor every known wire
supports. Declare it if your adapter carries more.

A WRAPPER must forward it (the three `src/resilience/` decorators do);
`withFallback` publishes the INTERSECTION of the two providers it holds,
because a role only one of them carries is a role the call might drop.

***

### name

> `readonly` **name**: `string`

Defined in: [src/adapters/types.ts:370](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L370)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/types.ts:404](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L404)

`hooks` (v7.8) is optional and additive — implementations may declare
`complete(req)` with no second parameter and stay assignable. A LEAF
provider (one that talks to a vendor) may ignore it. A WRAPPER must
forward it, or everything it wraps goes silently dark — see the
`LLMCallHooks` docs above.

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

***

### stream()?

> `optional` **stream**(`req`, `hooks?`): `AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>

Defined in: [src/adapters/types.ts:405](https://github.com/footprintjs/agentfootprint/blob/d630ddc0e0e611e1322ad7092c9a03baa7a88950/src/adapters/types.ts#L405)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>
