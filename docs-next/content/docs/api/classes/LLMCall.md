---
title: LLMCall
---

# Class: LLMCall

Defined in: [src/core/LLMCall.ts:156](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L156)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/docs/api/classes/RunnerBase)\<[`LLMCallInput`](/docs/api/interfaces/LLMCallInput), [`LLMCallOutput`](/docs/api/type-aliases/LLMCallOutput)\>

## Constructors

### Constructor

> **new LLMCall**(`opts`, `systemPromptValue`): `LLMCall`

Defined in: [src/core/LLMCall.ts:181](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L181)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

##### systemPromptValue

`string`

#### Returns

`LLMCall`

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`constructor`](/docs/api/classes/RunnerBase#constructor)

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/docs/api/interfaces/EnableNamespace)

Defined in: [src/core/RunnerBase.ts:484](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L484)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`enable`](/docs/api/classes/RunnerBase#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/LLMCall.ts:158](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L158)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/LLMCall.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L157)

## Methods

### attach()

> **attach**(`recorder`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:474](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L474)

Attach a footprintjs CombinedRecorder to observe every subsequent run.

LIFECYCLE CONTRACT (who owns cleanup):
- Attached recorders live for the RUNNER's lifetime, not a run's.
  NOTHING auto-expires per-run — a recorder attached once observes
  every later `run()` until you call the returned Unsubscribe.
- The CALLER owns cleanup. Keep the Unsubscribe and call it when the
  observer's life ends (request scope, UI unmount, test teardown).
- Event listeners (`on()` / `once()`) follow the same rule, with two
  extra outs: pass `{ signal }` for AbortSignal auto-cleanup, or call
  `removeAllListeners()` to bulk-drop listeners (listeners ONLY —
  recorders are not affected).
- `once()` listeners are the only self-expiring subscription.

attach() is NOT idempotent: every call pushes another entry. (At run
time footprintjs's executor dedupes recorders by ID, so same-ID
duplicates won't double-fire — but the runner-side array still
grows.) Attaching in a per-run loop without detaching is the classic
server leak; attach once, or detach per-run.

#### Parameters

##### recorder

[`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)

#### Returns

`Unsubscribe`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`attach`](/docs/api/classes/RunnerBase#attach)

***

### create()

> `static` **create**(`opts`): [`LLMCallBuilder`](/docs/api/classes/LLMCallBuilder)

Defined in: [src/core/LLMCall.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L209)

#### Parameters

##### opts

[`LLMCallOptions`](/docs/api/interfaces/LLMCallOptions)

#### Returns

[`LLMCallBuilder`](/docs/api/classes/LLMCallBuilder)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/RunnerBase.ts:522](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L522)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`emit`](/docs/api/classes/RunnerBase#emit)

***

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L108)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getLastSnapshot`](/docs/api/classes/RunnerBase#getlastsnapshot)

***

### getSnapshot()

> **getSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L123)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getSnapshot`](/docs/api/classes/RunnerBase#getsnapshot)

***

### getSpec()

> **getSpec**(): `FlowChart`

Defined in: [src/core/RunnerBase.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L144)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getSpec`](/docs/api/classes/RunnerBase#getspec)

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L180)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getUIGroup`](/docs/api/classes/RunnerBase#getuigroup)

***

### getUIGroupWith()

> **getUIGroupWith**\<`T`\>(`override`): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L224)

Translate this runner's group metadata with a CALLER-SUPPLIED
translator that overrides the runner's own default. Used by
parent compositions to apply per-method translator overrides.
See the `Runner.getUIGroupWith` JSDoc for the contract.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### override

[`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

#### Returns

`T` \| `undefined`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getUIGroupWith`](/docs/api/classes/RunnerBase#getuigroupwith)

***

### listenerCount()

> **listenerCount**(`type?`): `number`

Defined in: [src/core/RunnerBase.ts:447](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L447)

Diagnostic — how many event listeners this runner currently retains.
No argument = total across all buckets (the leak-detection number);
with a subscription key = that bucket only. Delegates to
`EventDispatcher.listenerCount()`.

#### Parameters

##### type?

keyof AgentfootprintEventMap \| `WildcardSubscription`

#### Returns

`number`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`listenerCount`](/docs/api/classes/RunnerBase#listenercount)

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:390](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L390)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`off`](/docs/api/classes/RunnerBase#off)

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:391](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L391)

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

##### Returns

`void`

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`off`](/docs/api/classes/RunnerBase#off)

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:367](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L367)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`on`](/docs/api/classes/RunnerBase#on)

#### Call Signature

> **on**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:372](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L372)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`on`](/docs/api/classes/RunnerBase#on)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:401](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L401)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`once`](/docs/api/classes/RunnerBase#once)

#### Call Signature

> **once**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L406)

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

###### options?

`Omit`\<`ListenOptions`, `"once"`\>

##### Returns

`Unsubscribe`

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`once`](/docs/api/classes/RunnerBase#once)

***

### removeAllListeners()

> **removeAllListeners**(): `void`

Defined in: [src/core/RunnerBase.ts:437](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L437)

Lifecycle escape hatch — drop EVERY event listener on this runner in
one call (typed, domain-wildcard, and `'*'`). Delegates to
`EventDispatcher.removeAllListeners()`.

For long-lived runners on servers: when you can't thread an
AbortSignal or keep every Unsubscribe handle, call this between
requests to guarantee zero residual subscriptions. Note it also
removes listeners wired by `enable.*` strategies — re-enable after
calling if you still want them. Does NOT touch attached recorders
(see `attach()` — recorders have their own Unsubscribe).

#### Returns

`void`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`removeAllListeners`](/docs/api/classes/RunnerBase#removealllisteners)

***

### resume()

> **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/LLMCall.ts:254](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L254)

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

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`resume`](/docs/api/classes/RunnerBase#resume)

***

### run()

> **run**(`input`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/LLMCall.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/core/LLMCall.ts#L241)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

[`LLMCallInput`](/docs/api/interfaces/LLMCallInput)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`run`](/docs/api/classes/RunnerBase#run)
