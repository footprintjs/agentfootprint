[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Loop

# Class: Loop

Defined in: [agentfootprint/src/core-flow/Loop.ts:63](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L63)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<[`LoopInput`](/agentfootprint/api/generated/interfaces/LoopInput.md), [`LoopOutput`](/agentfootprint/api/generated/type-aliases/LoopOutput.md)\>

## Constructors

### Constructor

> **new Loop**(`opts`, `body`, `config`): `Loop`

Defined in: [agentfootprint/src/core-flow/Loop.ts:77](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L77)

#### Parameters

##### opts

[`LoopOptions`](/agentfootprint/api/generated/interfaces/LoopOptions.md)

##### body

`BodyChild`

##### config

###### maxIterations

`number`

###### maxWallclockMs?

`number`

###### until?

[`UntilGuard`](/agentfootprint/api/generated/type-aliases/UntilGuard.md)

#### Returns

`Loop`

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

Defined in: [agentfootprint/src/core-flow/Loop.ts:65](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L65)

***

### name

> `readonly` **name**: `string`

Defined in: [agentfootprint/src/core-flow/Loop.ts:64](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L64)

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

> `static` **create**(`opts?`): [`LoopBuilder`](/agentfootprint/api/generated/classes/LoopBuilder.md)

Defined in: [agentfootprint/src/core-flow/Loop.ts:95](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L95)

#### Parameters

##### opts?

[`LoopOptions`](/agentfootprint/api/generated/interfaces/LoopOptions.md) = `{}`

#### Returns

[`LoopBuilder`](/agentfootprint/api/generated/classes/LoopBuilder.md)

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

Defined in: [agentfootprint/src/core-flow/Loop.ts:112](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L112)

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

Defined in: [agentfootprint/src/core-flow/Loop.ts:103](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L103)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes toFlowChart() + FlowChartExecutor.

#### Parameters

##### input

[`LoopInput`](/agentfootprint/api/generated/interfaces/LoopInput.md)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`run`](/agentfootprint/api/generated/classes/RunnerBase.md#run)

***

### toFlowChart()

> **toFlowChart**(): `FlowChart`

Defined in: [agentfootprint/src/core-flow/Loop.ts:99](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core-flow/Loop.ts#L99)

Build the footprintjs FlowChart for this runner. Subclass supplies
its specific structure (slot subflows, callLLM stage, routing, etc.).

#### Returns

`FlowChart`

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`toFlowChart`](/agentfootprint/api/generated/classes/RunnerBase.md#toflowchart)
