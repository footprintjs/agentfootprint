---
title: Runner<TIn, TOut>
---

# Interface: Runner\<TIn, TOut\>

Defined in: [src/core/runner.ts:95](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L95)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/docs/api/interfaces/EnableNamespace)

Defined in: [src/core/runner.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L231)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

## Methods

### attach()

> **attach**(`recorder`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/core/runner.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L223)

Attach a footprintjs CombinedRecorder to observe the execution.
Returns an unsubscribe function — call it to detach the recorder
from future runs. (Already-running executions continue using it.)

Recorders live for the RUNNER's lifetime: nothing auto-expires
per-run, and `removeAllListeners()` does not touch them. The caller
owns cleanup via the returned Unsubscribe.

#### Parameters

##### recorder

[`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)

#### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/runner.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L240)

Emit a consumer-defined custom event through the same dispatcher.

Matches DOM CustomEvent. Useful for domain-specific events outside
the 47-event registry (e.g. `myapp.billing.checkpoint`). Library
events are reserved under the `agentfootprint.*` namespace.

#### Parameters

##### name

`string`

##### payload

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### getSpec()

> **getSpec**(): `FlowChart`

Defined in: [src/core/runner.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L108)

Return the footprintjs FlowChart for this runner — the canonical
design-time blueprint. Stable across calls. Pairs with the run-time
accessors (`getLastSnapshot`, `getCommitCount`) and matches
`ExplainableShell.spec` + `specToReactFlow(spec, ...)` consumer
conventions.

Subflow mounting (footprintjs `addSubFlowChart*`) accepts the
`FlowChart` value directly:

  parent.addSubFlowChartNext('sf-agent', child.getSpec(), 'Agent')

#### Returns

`FlowChart`

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/runner.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L123)

Return the consumer-shaped UI group for this runner — produced by
invoking the `groupTranslator` (if one was attached at constructor
time) with this composition's metadata. Returns `undefined` when no
translator was attached.

Companion of `getSpec()`: `getSpec()` is the canonical (UI-
agnostic) blueprint; `getUIGroup()` is the consumer-shaped view.
Both are stable post-construction.

See `core/translator.ts` for the `GroupTranslator` /
`GroupMetadata` types.

#### Type Parameters

##### T

`T` = `unknown`

#### Returns

`T` \| `undefined`

***

### getUIGroupWith()

> **getUIGroupWith**\<`T`\>(`override`): `T` \| `undefined`

Defined in: [src/core/runner.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L142)

Translate this runner's group metadata with a CALLER-SUPPLIED
translator that OVERRIDES whatever translator (if any) the runner
was constructed with. Used by parent compositions to apply
per-method translator overrides (e.g.,
`Parallel.create(...).branch('special', runner, { groupTranslator: ... })`
— for the `'special'` branch only, this `override` runs against
`runner`'s own `GroupMetadata` instead of the runner's default
translator).

NOT cached at the runner level. The caller invokes this exactly
once per build (parent's `buildUIGroupMetadata`) and caches the
resulting `uiGroup` via the parent's `RunnerBase.uiGroupCache`.

Returns `undefined` when this runner has no group metadata to
translate (i.e., `buildUIGroupMetadata()` returned `undefined`).

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### override

[`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

#### Returns

`T` \| `undefined`

***

### listenerCount()

> **listenerCount**(`type?`): `number`

Defined in: [src/core/runner.ts:212](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L212)

Diagnostic — listeners currently retained. No argument = total
(the leak-detection number); with a subscription key = that exact
bucket only (wildcards not folded in — use the dispatcher's
`hasListenersFor` semantics for "would anything fire").

#### Parameters

##### type?

keyof AgentfootprintEventMap \| [`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

#### Returns

`number`

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/core/runner.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L182)

Unsubscribe a previously-registered listener.

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

Defined in: [src/core/runner.ts:183](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L183)

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

Defined in: [src/core/runner.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L173)

Subscribe a typed listener. Returns unsubscribe.

Lifecycle: the subscription lives until you call the returned
Unsubscribe, the `{ signal }` you passed aborts, or
`removeAllListeners()` runs. Nothing auto-expires per-run — pass a
per-run AbortSignal for request-scoped listeners on long-lived
runners (servers).

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

Defined in: [src/core/runner.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L179)

Subscribe to a domain wildcard (e.g. 'agentfootprint.context.*') or '*'.

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

Defined in: [src/core/runner.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L186)

Subscribe a one-shot listener (fires once then auto-removes). Accepts `{ signal }`.

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

Defined in: [src/core/runner.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L191)

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

Defined in: [src/core/runner.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L204)

Drop every event listener on this runner in one call (typed,
domain-wildcard, and `'*'`). Lifecycle escape hatch for server
consumers that can't keep Unsubscribe handles. Also removes
listeners wired by `enable.*` strategies; does NOT detach recorders
added via `attach()`.

#### Returns

`void`

***

### resume()

> **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<`TOut` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/runner.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L158)

Resume a previously-paused execution from its checkpoint. `input` is
delivered to the paused stage's resume handler. The same return shape
as `run()`: `TOut` on completion, `RunnerPauseOutcome` if execution
pauses again (e.g., a multi-step approval flow).

#### Parameters

##### checkpoint

`FlowchartCheckpoint`

##### input?

`unknown`

##### options?

`RunOptions`

#### Returns

`Promise`\<`TOut` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

***

### run()

> **run**(`input`, `options?`): `Promise`\<`TOut` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/runner.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L150)

Execute the runner. On happy-path completion, resolves with `TOut`.
If any stage (Agent tool via `pauseHere`, nested runner, or consumer
scope code) called `scope.$pause()`, resolves with a `RunnerPauseOutcome`
carrying the serializable checkpoint. Discriminate with `isPaused()`.

#### Parameters

##### input

`TIn`

##### options?

`RunOptions`

#### Returns

`Promise`\<`TOut` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>
