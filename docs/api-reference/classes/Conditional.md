[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Conditional

# Class: Conditional

Defined in: [src/core-flow/Conditional.ts:93](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L93)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<[`ConditionalInput`](/agentfootprint/api/generated/interfaces/ConditionalInput.md), [`ConditionalOutput`](/agentfootprint/api/generated/type-aliases/ConditionalOutput.md)\>

## Constructors

### Constructor

> **new Conditional**(`opts`, `branches`, `fallbackId`): `Conditional`

Defined in: [src/core-flow/Conditional.ts:106](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L106)

#### Parameters

##### opts

[`ConditionalOptions`](/agentfootprint/api/generated/interfaces/ConditionalOptions.md)

##### branches

readonly `BranchEntry`[]

##### fallbackId

`string`

#### Returns

`Conditional`

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`constructor`](/agentfootprint/api/generated/classes/RunnerBase.md#constructor)

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/agentfootprint/api/generated/interfaces/EnableNamespace.md)

Defined in: [src/core/RunnerBase.ts:419](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L419)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`enable`](/agentfootprint/api/generated/classes/RunnerBase.md#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core-flow/Conditional.ts:95](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L95)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core-flow/Conditional.ts:94](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L94)

## Methods

### attach()

> **attach**(`recorder`): [`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

Defined in: [src/core/RunnerBase.ts:409](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L409)

Attach a footprintjs CombinedRecorder to observe the execution.
Returns an unsubscribe function — call it to detach the recorder
from future runs. (Already-running executions continue using it.)

#### Parameters

##### recorder

[`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

#### Returns

[`Unsubscribe`](/agentfootprint/api/generated/type-aliases/Unsubscribe.md)

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`attach`](/agentfootprint/api/generated/classes/RunnerBase.md#attach)

***

### create()

> `static` **create**(`opts?`): [`ConditionalBuilder`](/agentfootprint/api/generated/classes/ConditionalBuilder.md)

Defined in: [src/core-flow/Conditional.ts:120](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L120)

#### Parameters

##### opts?

[`ConditionalOptions`](/agentfootprint/api/generated/interfaces/ConditionalOptions.md) = `{}`

#### Returns

[`ConditionalBuilder`](/agentfootprint/api/generated/classes/ConditionalBuilder.md)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/RunnerBase.ts:444](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L444)

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

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:103](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L103)

Returns the footprintjs snapshot from the most recent run (or
undefined if no run has completed). The snapshot is the CANONICAL
STRUCTURE: nodes, edges, executionTree, runtimeStageId, commitLog.

Domain consumers (Lens, Trace, dashboards) read this for shape
and join their own per-stage payload by `runtimeStageId`. They
MUST NOT re-derive structure from typed events — that's the
design footprintjs's CLAUDE.md Convention 1 explicitly forbids.

Returns `undefined` before the first `run()` completes. After,
always returns the snapshot of the most recent run (including
across multi-turn reuse of the same runner instance).

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getLastSnapshot`](/agentfootprint/api/generated/classes/RunnerBase.md#getlastsnapshot)

***

### getSnapshot()

> **getSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:118](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L118)

Alias for `getLastSnapshot()` that mirrors `FlowChartExecutor.getSnapshot()`
so consumers (lens, playground, ExplainableShell) can read the live or
just-completed snapshot through the same method name they'd use on a
footprintjs executor — without having to know whether they're holding
an agentfootprint Runner or a raw executor.

During an active run, returns the live snapshot (commit log + execution
tree built incrementally as stages execute). Between runs, returns the
last completed run's snapshot. Undefined before any run has started.

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getSnapshot`](/agentfootprint/api/generated/classes/RunnerBase.md#getsnapshot)

***

### getSpec()

> **getSpec**(): `FlowChart`

Defined in: [src/core/RunnerBase.ts:139](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L139)

Return the footprintjs FlowChart for this runner — the canonical
design-time blueprint. STABLE REFERENCE across calls (`getSpec()
=== getSpec()`). Set once at construction via `initChart()`.

Pairs with the run-time getters (`getLastSnapshot`,
`getCommitCount`) and matches `ExplainableShell.spec` +
`specToReactFlow(spec, ...)` consumer conventions.

DO NOT OVERRIDE in subclasses — the reference-identity contract
(Lens / OpenAPI / MCP caches memo on this returning the same
object) depends on the inherited body returning `this.chart`
directly. To customise build behaviour, override `buildChart()`
instead; this getter must remain a thin cache-read.

#### Returns

`FlowChart`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getSpec`](/agentfootprint/api/generated/classes/RunnerBase.md#getspec)

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:175](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L175)

Return the consumer-shaped UI group for this composition — produced
by invoking the consumer's `groupTranslator` (if attached) with this
runner's `GroupMetadata`. Returns `undefined` when no translator was
attached.

STABLE REFERENCE across calls. Computed on first access and cached;
subsequent calls return the same value. Pairs with `getSpec()` —
library shape on one side, consumer-shaped UI on the other.

Subclasses MUST override `buildUIGroupMetadata()` (the next hook) to
supply the `GroupMetadata` for their composition kind. This method
(the public surface) is `final`-by-convention — do not override.

#### Type Parameters

##### T

`T` = `unknown`

#### Returns

`T` \| `undefined`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getUIGroup`](/agentfootprint/api/generated/classes/RunnerBase.md#getuigroup)

***

### getUIGroupWith()

> **getUIGroupWith**\<`T`\>(`override`): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:219](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L219)

Translate this runner's group metadata with a CALLER-SUPPLIED
translator that overrides the runner's own default. Used by
parent compositions to apply per-method translator overrides.
See the `Runner.getUIGroupWith` JSDoc for the contract.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### override

[`GroupTranslator`](/agentfootprint/api/generated/interfaces/GroupTranslator.md)\<`unknown`\>

#### Returns

`T` \| `undefined`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getUIGroupWith`](/agentfootprint/api/generated/classes/RunnerBase.md#getuigroupwith)

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:385](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L385)

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

Defined in: [src/core/RunnerBase.ts:386](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L386)

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

Defined in: [src/core/RunnerBase.ts:362](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L362)

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

Defined in: [src/core/RunnerBase.ts:367](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L367)

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

Defined in: [src/core/RunnerBase.ts:396](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L396)

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

Defined in: [src/core/RunnerBase.ts:397](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/RunnerBase.ts#L397)

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

Defined in: [src/core-flow/Conditional.ts:166](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L166)

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

Defined in: [src/core-flow/Conditional.ts:153](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core-flow/Conditional.ts#L153)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

[`ConditionalInput`](/agentfootprint/api/generated/interfaces/ConditionalInput.md)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`run`](/agentfootprint/api/generated/classes/RunnerBase.md#run)
