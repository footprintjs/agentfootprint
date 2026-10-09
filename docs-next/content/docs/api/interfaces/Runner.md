---
title: Runner<TIn, TOut>
---

# Interface: Runner\<TIn, TOut\>

Defined in: [src/core/runner.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L109)

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

Defined in: [src/core/runner.ts:287](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L287)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

## Methods

### attach()

> **attach**(`recorder`): `Unsubscribe`

Defined in: [src/core/runner.ts:279](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L279)

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

`Unsubscribe`

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/runner.ts:311](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L311)

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

### getCommitCount()

> **getCommitCount**(): `number`

Defined in: [src/core/runner.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L158)

How many commits the run has written so far — the run's TIME AXIS.

One commit lands per executed stage, in order, so the count sampled
at a moment is that moment's position in the run. Observers stamp it
to record WHEN they fired — it is what `boundaryRecorder({
getCommitCount })` puts on every boundary, and the only reason a
step strip can be rebuilt from a stored recording later.

`0` before the first run; cumulative across `resume()` on the same
executor. Sample it live (a closure), never a captured number.

#### Returns

`number`

***

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/runner.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L144)

The footprintjs snapshot of the most recent run — shared state, the
commit log, the execution tree, and every attached recorder's data.
`undefined` before the first run.

The canonical structure: consumers read this for shape and join
their own per-stage payload by `runtimeStageId`, rather than
re-deriving structure from typed events.

#### Returns

`RuntimeSnapshot` \| `undefined`

***

### getSpec()

> **getSpec**(): `FlowChart`

Defined in: [src/core/runner.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L133)

Return the footprintjs FlowChart for this runner — the canonical
design-time blueprint. Stable across calls. Pairs with the run-time
accessors (`getLastSnapshot`, `getCommitCount`) and matches
`ExplainableShell.spec` + `specToReactFlow(spec, ...)` consumer
conventions.

Its `buildTimeStructure` field is the CHART — the one ingredient a
finished run does not leave behind, and the only route to a drawable
graph. Save it alongside the snapshot when storing a run (or let
`recordRun()` do it).

Subflow mounting (footprintjs `addSubFlowChart*`) accepts the
`FlowChart` value directly:

  parent.addSubFlowChartNext('sf-agent', child.getSpec(), 'Agent')

Mounted into an executor you build yourself, the chart's typed events are
still served under the `redact` the runner declares — your executor's own
policy never reaches them, so declare it on the runner; its STATE belongs
to your executor and follows that executor's own redaction policy
(`src/redaction/README.md`, "A runner's chart mounted into your own executor").

#### Returns

`FlowChart`

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/runner.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L173)

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

Defined in: [src/core/runner.ts:192](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L192)

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

Defined in: [src/core/runner.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L268)

Diagnostic — listeners currently retained. No argument = total
(the leak-detection number); with a subscription key = that exact
bucket only (wildcards not folded in — use the dispatcher's
`hasListenersFor` semantics for "would anything fire").

#### Parameters

##### type?

keyof AgentfootprintEventMap \| `WildcardSubscription`

#### Returns

`number`

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/core/runner.ts:238](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L238)

Unsubscribe a previously-registered listener.

##### Type Parameters

###### K

`K` *extends* keyof `AgentfootprintEventMap`

##### Parameters

###### type

`K`

###### listener

`EventListener`\<`K`\>

##### Returns

`void`

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/core/runner.ts:239](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L239)

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

##### Returns

`void`

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/runner.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L229)

Subscribe a typed listener. Returns unsubscribe.

Lifecycle: the subscription lives until you call the returned
Unsubscribe, the `{ signal }` you passed aborts, or
`removeAllListeners()` runs. Nothing auto-expires per-run — pass a
per-run AbortSignal for request-scoped listeners on long-lived
runners (servers).

##### Type Parameters

###### K

`K` *extends* keyof `AgentfootprintEventMap`

##### Parameters

###### type

`K`

###### listener

`EventListener`\<`K`\>

###### options?

`ListenOptions`

##### Returns

`Unsubscribe`

#### Call Signature

> **on**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/runner.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L235)

Subscribe to a domain wildcard (e.g. 'agentfootprint.context.*') or '*'.

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

###### options?

`ListenOptions`

##### Returns

`Unsubscribe`

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/runner.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L242)

Subscribe a one-shot listener (fires once then auto-removes). Accepts `{ signal }`.

##### Type Parameters

###### K

`K` *extends* keyof `AgentfootprintEventMap`

##### Parameters

###### type

`K`

###### listener

`EventListener`\<`K`\>

###### options?

`Omit`\<`ListenOptions`, `"once"`\>

##### Returns

`Unsubscribe`

#### Call Signature

> **once**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/runner.ts:247](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L247)

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

###### options?

`Omit`\<`ListenOptions`, `"once"`\>

##### Returns

`Unsubscribe`

***

### removeAllListeners()

> **removeAllListeners**(): `void`

Defined in: [src/core/runner.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L260)

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

Defined in: [src/core/runner.ts:214](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L214)

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

Defined in: [src/core/runner.ts:206](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L206)

Execute the runner. On happy-path completion, resolves with `TOut`.
If any stage (Agent tool via `pauseHere`, nested runner, or consumer
scope code) called `scope.$pause()`, resolves with a `RunnerPauseOutcome`
carrying the serializable checkpoint. Discriminate with `isPaused()`.

**A bare string is accepted wherever `TIn` is the `{ message }` bag**
(8.18.0): `run('go')` means `run({ message: 'go' })`. The port declares
the union so every implementation shares one door — the shipped runners
normalize through `normalizeRunInput`, which also refuses, by name,
anything that is not a message.

#### Parameters

##### input

`string` \| `TIn`

##### options?

`RunOptions`

#### Returns

`Promise`\<`TOut` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

***

### shutdown()?

> `optional` **shutdown**(`options?`): `Promise`\<`void`\>

Defined in: [src/core/runner.ts:302](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runner.ts#L302)

Drain and release what was enabled on this runner (8.12.0).

**The agent itself remains usable afterwards; `shutdown()` drains and
releases what was enabled on it.** Call it when a process is stopping, a
script is ending, or a test is tearing down — a batching exporter
(CloudWatch, X-Ray) otherwise loses whatever it had buffered when the
process exits.

Optional on this INTERFACE so an outside implementation of `Runner` is
not broken by its arrival; every runner this package ships implements it.
See `RunnerBase.shutdown` for the ordering and the refcount rules.

#### Parameters

##### options?

###### stop?

`boolean`

#### Returns

`Promise`\<`void`\>
