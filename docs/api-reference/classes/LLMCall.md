[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMCall

# Class: LLMCall

Defined in: [agentfootprint/src/core/LLMCall.ts:91](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L91)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<[`LLMCallInput`](/agentfootprint/api/generated/interfaces/LLMCallInput.md), [`LLMCallOutput`](/agentfootprint/api/generated/type-aliases/LLMCallOutput.md)\>

## Constructors

### Constructor

> **new LLMCall**(`opts`, `systemPromptValue`): `LLMCall`

Defined in: [agentfootprint/src/core/LLMCall.ts:109](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L109)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

##### systemPromptValue

`string`

#### Returns

`LLMCall`

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`constructor`](/agentfootprint/api/generated/classes/RunnerBase.md#constructor)

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/agentfootprint/api/generated/interfaces/EnableNamespace.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:225](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L225)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`enable`](/agentfootprint/api/generated/classes/RunnerBase.md#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/core/LLMCall.ts:93](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L93)

***

### name

> `readonly` **name**: `string`

Defined in: [agentfootprint/src/core/LLMCall.ts:92](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L92)

## Methods

### attach()

> **attach**(`recorder`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:215](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L215)

Attach a footprintjs CombinedRecorder to observe the execution.
Returns an unsubscribe function — call it to detach the recorder
from future runs. (Already-running executions continue using it.)

#### Parameters

##### recorder

`CombinedRecorder`

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`attach`](/agentfootprint/api/generated/classes/RunnerBase.md#attach)

***

### create()

> `static` **create**(`opts`): [`LLMCallBuilder`](/agentfootprint/api/generated/classes/LLMCallBuilder.md)

Defined in: [agentfootprint/src/core/LLMCall.ts:122](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L122)

#### Parameters

##### opts

[`LLMCallOptions`](/agentfootprint/api/generated/interfaces/LLMCallOptions.md)

#### Returns

[`LLMCallBuilder`](/agentfootprint/api/generated/classes/LLMCallBuilder.md)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [agentfootprint/src/core/RunnerBase.ts:247](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L247)

Emit a consumer-defined custom event.

If `name` matches a registered event type, this routes exactly like a
library-emitted event (via the typed EventMap). Otherwise it flows
through to wildcard listeners (`'*'`) as an opaque CustomEvent with
minimal meta. Library events remain reserved under `agentfootprint.*`.

#### Parameters

##### name

`string`

##### payload

`Record`\<`string`, `unknown`\>

#### Returns

`void`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`emit`](/agentfootprint/api/generated/classes/RunnerBase.md#emit)

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [agentfootprint/src/core/RunnerBase.ts:191](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L191)

Unsubscribe a previously-registered listener.

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

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`off`](/agentfootprint/api/generated/classes/RunnerBase.md#off)

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [agentfootprint/src/core/RunnerBase.ts:192](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L192)

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

##### Returns

`void`

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`off`](/agentfootprint/api/generated/classes/RunnerBase.md#off)

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:168](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L168)

Subscribe a typed listener. Returns unsubscribe.

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

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`on`](/agentfootprint/api/generated/classes/RunnerBase.md#on)

#### Call Signature

> **on**(`type`, `listener`, `options?`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:173](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L173)

Subscribe to a domain wildcard (e.g. 'agentfootprint.context.*') or '*'.

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

###### options?

[`ListenOptions`](/agentfootprint/api/generated/interfaces/ListenOptions.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`on`](/agentfootprint/api/generated/classes/RunnerBase.md#on)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:202](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L202)

Subscribe a one-shot listener (fires once then auto-removes).

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

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`once`](/agentfootprint/api/generated/classes/RunnerBase.md#once)

#### Call Signature

> **once**(`type`, `listener`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:203](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L203)

##### Parameters

###### type

[`WildcardSubscription`](/agentfootprint/api/generated/type-aliases/WildcardSubscription.md)

###### listener

[`WildcardListener`](/agentfootprint/api/generated/type-aliases/WildcardListener.md)

##### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`once`](/agentfootprint/api/generated/classes/RunnerBase.md#once)

***

### resume()

> **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

Defined in: [agentfootprint/src/core/LLMCall.ts:142](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L142)

Resume a paused run from its checkpoint. Default behavior: rebuild the
chart, wire the same core recorders + consumer recorders, call
`executor.resume(checkpoint, input)`, and emit `pause.resume` before
returning. Subclass overrides only if it needs specialized behavior.

#### Parameters

##### checkpoint

`FlowchartCheckpoint`

##### input?

`unknown`

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`resume`](/agentfootprint/api/generated/classes/RunnerBase.md#resume)

***

### run()

> **run**(`input`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

Defined in: [agentfootprint/src/core/LLMCall.ts:130](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L130)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes toFlowChart() + FlowChartExecutor.

#### Parameters

##### input

[`LLMCallInput`](/agentfootprint/api/generated/interfaces/LLMCallInput.md)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`run`](/agentfootprint/api/generated/classes/RunnerBase.md#run)

***

### toFlowChart()

> **toFlowChart**(): `FlowChart`

Defined in: [agentfootprint/src/core/LLMCall.ts:126](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/LLMCall.ts#L126)

Build the footprintjs FlowChart for this runner. Subclass supplies
its specific structure (slot subflows, callLLM stage, routing, etc.).

#### Returns

`FlowChart`

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`toFlowChart`](/agentfootprint/api/generated/classes/RunnerBase.md#toflowchart)
