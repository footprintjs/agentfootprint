[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RunnerBase

# Abstract Class: RunnerBase\<TIn, TOut\>

Defined in: [agentfootprint/src/core/RunnerBase.ts:54](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L54)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extended by

- [`LLMCall`](/agentfootprint/api/generated/classes/LLMCall.md)
- [`Agent`](/agentfootprint/api/generated/classes/Agent.md)
- [`Sequence`](/agentfootprint/api/generated/classes/Sequence.md)
- [`Parallel`](/agentfootprint/api/generated/classes/Parallel.md)
- [`Conditional`](/agentfootprint/api/generated/classes/Conditional.md)
- [`Loop`](/agentfootprint/api/generated/classes/Loop.md)

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Implements

- [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<`TIn`, `TOut`\>

## Constructors

### Constructor

> **new RunnerBase**\<`TIn`, `TOut`\>(): `RunnerBase`\<`TIn`, `TOut`\>

#### Returns

`RunnerBase`\<`TIn`, `TOut`\>

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/agentfootprint/api/generated/interfaces/EnableNamespace.md)

Defined in: [agentfootprint/src/core/RunnerBase.ts:225](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L225)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`enable`](/agentfootprint/api/generated/interfaces/Runner.md#enable)

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

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`attach`](/agentfootprint/api/generated/interfaces/Runner.md#attach)

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

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`emit`](/agentfootprint/api/generated/interfaces/Runner.md#emit)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`off`](/agentfootprint/api/generated/interfaces/Runner.md#off)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`off`](/agentfootprint/api/generated/interfaces/Runner.md#off)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`on`](/agentfootprint/api/generated/interfaces/Runner.md#on)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`on`](/agentfootprint/api/generated/interfaces/Runner.md#on)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`once`](/agentfootprint/api/generated/interfaces/Runner.md#once)

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

##### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`once`](/agentfootprint/api/generated/interfaces/Runner.md#once)

***

### resume()

> `abstract` **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

Defined in: [agentfootprint/src/core/RunnerBase.ts:78](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L78)

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

`Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`resume`](/agentfootprint/api/generated/interfaces/Runner.md#resume)

***

### run()

> `abstract` **run**(`input`, `options?`): `Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

Defined in: [agentfootprint/src/core/RunnerBase.ts:70](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L70)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes toFlowChart() + FlowChartExecutor.

#### Parameters

##### input

`TIn`

##### options?

`RunOptions`

#### Returns

`Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`run`](/agentfootprint/api/generated/interfaces/Runner.md#run)

***

### toFlowChart()

> `abstract` **toFlowChart**(): `FlowChart`

Defined in: [agentfootprint/src/core/RunnerBase.ts:64](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/core/RunnerBase.ts#L64)

Build the footprintjs FlowChart for this runner. Subclass supplies
its specific structure (slot subflows, callLLM stage, routing, etc.).

#### Returns

`FlowChart`

#### Implementation of

[`Runner`](/agentfootprint/api/generated/interfaces/Runner.md).[`toFlowChart`](/agentfootprint/api/generated/interfaces/Runner.md#toflowchart)
