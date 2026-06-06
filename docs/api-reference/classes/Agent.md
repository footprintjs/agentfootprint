[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Agent

# Class: Agent

Defined in: [src/core/Agent.ts:103](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L103)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<[`AgentInput`](/agentfootprint/api/generated/interfaces/AgentInput.md), [`AgentOutput`](/agentfootprint/api/generated/type-aliases/AgentOutput.md)\>

## Constructors

### Constructor

> **new Agent**(`opts`, `systemPromptValue`, `registry`, `voice`, `injections?`, `memories?`, `outputSchemaParser?`, `toolProvider?`, `systemPromptCachePolicy?`, `cachingDisabled?`, `cacheStrategy?`, `outputFallbackCfg?`, `reliabilityConfig?`, `thinkingHandlerValue?`, `thinkingBudgetValue?`): `Agent`

Defined in: [src/core/Agent.ts:252](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L252)

#### Parameters

##### opts

[`AgentOptions`](/agentfootprint/api/generated/interfaces/AgentOptions.md)

##### systemPromptValue

`string`

##### registry

readonly [`ToolRegistryEntry`](/agentfootprint/api/generated/interfaces/ToolRegistryEntry.md)[]

##### voice

###### appName

`string`

###### commentaryTemplates

`Readonly`\<`Record`\<`string`, `string`\>\>

###### thinkingTemplates

`Readonly`\<`Record`\<`string`, `string`\>\>

##### injections?

readonly [`Injection`](/agentfootprint/api/generated/interfaces/Injection.md)[] = `[]`

##### memories?

readonly [`MemoryDefinition`](/agentfootprint/api/generated/interfaces/MemoryDefinition.md)\<`unknown`\>[] = `[]`

##### outputSchemaParser?

[`OutputSchemaParser`](/agentfootprint/api/generated/interfaces/OutputSchemaParser.md)\<`unknown`\>

##### toolProvider?

[`ToolProvider`](/agentfootprint/api/generated/interfaces/ToolProvider.md)

##### systemPromptCachePolicy?

`CachePolicy` = `'always'`

##### cachingDisabled?

`boolean` = `false`

##### cacheStrategy?

`CacheStrategy`

##### outputFallbackCfg?

`ResolvedOutputFallback`\<`unknown`\>

##### reliabilityConfig?

`ReliabilityConfig`

##### thinkingHandlerValue?

`ThinkingHandler` \| `null`

##### thinkingBudgetValue?

`number`

#### Returns

`Agent`

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`constructor`](/agentfootprint/api/generated/classes/RunnerBase.md#constructor)

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/core/Agent.ts:151](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L151)

Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
`appName` is the active actor in narration ("Chatbot called…").
`commentaryTemplates` drives Lens's third-person panel.
`thinkingTemplates` drives chat-bubble first-person status.
Defaults to bundled English; consumer overrides via builder.

***

### commentaryTemplates

> `readonly` **commentaryTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:152](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L152)

***

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

Defined in: [src/core/Agent.ts:105](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L105)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/Agent.ts:104](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L104)

***

### thinkingTemplates

> `readonly` **thinkingTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:153](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L153)

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

> `static` **create**(`opts`): [`AgentBuilder`](/agentfootprint/api/generated/classes/AgentBuilder.md)

Defined in: [src/core/Agent.ts:345](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L345)

#### Parameters

##### opts

[`AgentOptions`](/agentfootprint/api/generated/interfaces/AgentOptions.md)

#### Returns

[`AgentBuilder`](/agentfootprint/api/generated/classes/AgentBuilder.md)

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

### getLastNarrativeEntries()

> **getLastNarrativeEntries**(): readonly `CombinedNarrativeEntry`[]

Defined in: [src/core/Agent.ts:380](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L380)

Structured narrative entries from the most recent run. Pairs with
`getLastSnapshot()` for ExplainableShell's `narrativeEntries` prop.
Empty array (not `undefined`) when no run has completed — matches
the prop's expected shape so consumers can wire it directly without
a defensive guard.

#### Returns

readonly `CombinedNarrativeEntry`[]

***

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/Agent.ts:369](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L369)

The footprintjs `RuntimeSnapshot` from the most recent `run()` /
`resume()`. Feeds Lens's Trace tab (ExplainableShell `runtimeSnapshot`
prop) so consumers can scrub the execution timeline post-run without
threading a recorder through the call site.

Returns `undefined` before the first run completes. Returns the
snapshot of the most recent run on every call after — including
across multiple turns of the same Agent instance.

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Overrides

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

### getSystemPromptCachePolicy()

> **getSystemPromptCachePolicy**(): `CachePolicy`

Defined in: [src/core/Agent.ts:355](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L355)

Cache policy for the base system prompt. Read by the CacheDecision
subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
cache markers. Exposed as a method (not direct field access) so
the Agent's encapsulation boundary stays clean.

#### Returns

`CachePolicy`

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

### parseOutput()

> **parseOutput**\<`T`\>(`raw`): `T`

Defined in: [src/core/Agent.ts:435](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L435)

Parse + validate a raw agent answer against the agent's
`outputSchema` parser. Throws `OutputSchemaError` on JSON parse
or schema validation failure (the rawOutput is preserved on the
error for triage). Throws a plain `Error` if the agent has no
outputSchema set.

Use this when you need to keep `agent.run()` returning the raw
string for logging/observability and validate at a different
layer; otherwise prefer `agent.runTyped()`.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### raw

`string`

#### Returns

`T`

***

### parseOutputAsync()

> **parseOutputAsync**\<`T`\>(`raw`): `Promise`\<`T`\>

Defined in: [src/core/Agent.ts:455](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L455)

Async sister of `parseOutput()`. When the agent is configured
with `.outputFallback({...})`, this is the version that engages
the 3-tier degradation chain on validation failure (the sync
`parseOutput` always throws on failure for back-compat).

Without `outputFallback`, behaves identically to `parseOutput`
— returns sync-style on the happy path, throws OutputSchemaError
on validation failure.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### raw

`string`

#### Returns

`Promise`\<`T`\>

***

### resume()

> **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

Defined in: [src/core/Agent.ts:643](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L643)

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

### resumeOnError()

> **resumeOnError**(`checkpoint`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

Defined in: [src/core/Agent.ts:600](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L600)

Resume an agent run from a checkpoint produced by a prior
`RunCheckpointError`. Unlike `agent.resume()` (which takes a
`FlowchartCheckpoint` from an intentional pause), this takes
an `AgentRunCheckpoint` (conversation-history snapshot) and
replays the agent run with that history restored.

The next iteration retries the call that originally failed —
with the latest provider state (circuit breaker may have
closed, vendor may have recovered, etc.).

#### Parameters

##### checkpoint

`unknown`

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Example

```ts
try {
  const result = await agent.run({ message: 'long task' });
} catch (err) {
  if (err instanceof RunCheckpointError) {
    await checkpointStore.put(sessionId, err.checkpoint);
    // hours / restart later:
    const checkpoint = await checkpointStore.get(sessionId);
    const result = await agent.resumeOnError(checkpoint);
  }
}
```

***

### run()

> **run**(`input`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

Defined in: [src/core/Agent.ts:519](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L519)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

[`AgentInput`](/agentfootprint/api/generated/interfaces/AgentInput.md)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md)\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`run`](/agentfootprint/api/generated/classes/RunnerBase.md#run)

***

### runTyped()

> **runTyped**\<`T`\>(`input`, `options?`): `Promise`\<`T`\>

Defined in: [src/core/Agent.ts:502](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/core/Agent.ts#L502)

Run the agent and return the schema-validated typed output.
Convenience over `parseOutputAsync(await agent.run({...}))`.

Throws `OutputSchemaError` on parse / validation failure UNLESS
`.outputFallback({...})` is configured, in which case the
3-tier degradation chain (primary → fallback → canned) engages.

Throws if the agent has no outputSchema set or if the run
pauses (use `run()` directly when pauses are expected).

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### input

[`AgentInput`](/agentfootprint/api/generated/interfaces/AgentInput.md)

##### options?

`RunOptions`

#### Returns

`Promise`\<`T`\>
