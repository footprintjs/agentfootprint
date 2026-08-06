[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMProvider

# Interface: LLMProvider

Defined in: [src/adapters/types.ts:391](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L391)

## Properties

### carriesForcedToolChoice?

> `readonly` `optional` **carriesForcedToolChoice?**: `boolean`

Defined in: [src/adapters/types.ts:442](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L442)

v7.26 — whether this adapter puts [LLMRequest.toolChoice](/agentfootprint/api/generated/interfaces/LLMRequest.md#toolchoice) on its
wire as a forced choice of one named tool.

**Absence means NO, not "probably".** That is the opposite of
`carriesInMessages`, whose absence means the floor every wire supports,
and the difference is what the two capabilities are for. A role that
quietly vanishes costs a message; a tool choice that quietly vanishes
costs the guarantee the consumer selected the strategy FOR — the model
would answer in whatever shape it liked while the config said the shape
was constrained. So an agent using `strategy: 'tool-forced'` on a
provider that has not declared this refuses at run start, by name.

Declare it only where it is true of the endpoint, not of the SDK: the
OpenAI adapter declares it for real OpenAI and Azure and NOT behind a
custom `baseURL` (Ollama, vLLM, Together, …), because what an
OpenAI-compatible server does with `tool_choice` is that server's
business and this library does not get to promise it.

A WRAPPER must forward it; `withFallback` publishes the AND of the two
providers it holds, since a call that might be served by either is only
constrained if both constrain it.

***

### carriesInMessages?

> `readonly` `optional` **carriesInMessages?**: readonly [`WireRole`](/agentfootprint/api/generated/type-aliases/WireRole.md)[]

Defined in: [src/adapters/types.ts:418](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L418)

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

Defined in: [src/adapters/types.ts:392](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L392)

## Methods

### complete()

> **complete**(`req`, `hooks?`): `Promise`\<[`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)\>

Defined in: [src/adapters/types.ts:450](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L450)

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

Defined in: [src/adapters/types.ts:451](https://github.com/footprintjs/agentfootprint/blob/7e60be4bdc7314eb1aa9110d77f8f728bb948866/src/adapters/types.ts#L451)

#### Parameters

##### req

[`LLMRequest`](/agentfootprint/api/generated/interfaces/LLMRequest.md)

##### hooks?

[`LLMCallHooks`](/agentfootprint/api/generated/interfaces/LLMCallHooks.md)

#### Returns

`AsyncIterable`\<[`LLMChunk`](/agentfootprint/api/generated/interfaces/LLMChunk.md)\>
