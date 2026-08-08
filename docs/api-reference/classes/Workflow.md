[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Workflow

# Class: Workflow\<TIn, TOut\>

Defined in: [src/core-flow/Workflow.ts:143](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L143)

A sequential composition that passes values through untouched. Build one
with [workflow](/agentfootprint/api/generated/functions/workflow.md) — that factory carries the type-level chain proof.

## Extends

- [`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md)\<`TIn`, `TOut`\>

## Type Parameters

### TIn

`TIn` *extends* `object` = `object`

### TOut

`TOut` = `unknown`

## Constructors

### Constructor

> **new Workflow**\<`TIn`, `TOut`\>(`steps`, `opts?`): `Workflow`\<`TIn`, `TOut`\>

Defined in: [src/core-flow/Workflow.ts:155](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L155)

#### Parameters

##### steps

readonly `AnyStep`[]

##### opts?

[`WorkflowOptions`](/agentfootprint/api/generated/interfaces/WorkflowOptions.md) = `{}`

#### Returns

`Workflow`\<`TIn`, `TOut`\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`constructor`](/agentfootprint/api/generated/classes/RunnerBase.md#constructor)

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/agentfootprint/api/generated/interfaces/EnableNamespace.md)

Defined in: [src/core/RunnerBase.ts:633](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L633)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`enable`](/agentfootprint/api/generated/classes/RunnerBase.md#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core-flow/Workflow.ts:145](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L145)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core-flow/Workflow.ts:144](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L144)

## Methods

### attach()

> **attach**(`recorder`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:529](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L529)

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

[`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)

#### Returns

`Unsubscribe`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`attach`](/agentfootprint/api/generated/classes/RunnerBase.md#attach)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/RunnerBase.ts:681](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L681)

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

### getCommitCount()

> **getCommitCount**(): `number`

Defined in: [src/core/RunnerBase.ts:150](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L150)

How many commits the run has written so far — footprintjs's
`executor.getCommitCount()`, forwarded.

This is the run's TIME AXIS. One commit lands per executed stage, in
order, so the count sampled at some moment is that moment's position
in the run. Observers stamp it to say WHEN they fired: it is what
`boundaryRecorder({ getCommitCount })` records on every boundary, and
the only reason a step strip can be rebuilt from a stored recording
later. Sample it live, at the moment of the event — a number read
once and captured is a number about the wrong instant.

`0` before the first run, and during a run it climbs; between runs it
is the last run's total. Cumulative across `resume()` on the same
executor, and it counts the whole run — a subflow's own commits are
kept out of the run-level log by footprintjs, so this is the parent
timeline, not a sum of every nested one.

#### Returns

`number`

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`getCommitCount`](/agentfootprint/api/generated/classes/RunnerBase.md#getcommitcount)

***

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:113](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L113)

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

Defined in: [src/core/RunnerBase.ts:128](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L128)

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

Defined in: [src/core/RunnerBase.ts:173](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L173)

Return the footprintjs FlowChart for this runner — the canonical
design-time blueprint. STABLE REFERENCE across calls (`getSpec()
=== getSpec()`). Set once at construction via `initChart()`.

Pairs with the run-time getters (`getLastSnapshot`,
`getCommitCount`) and matches `ExplainableShell.spec` +
`specToReactFlow(spec, ...)` consumer conventions. Its
`buildTimeStructure` field is what a viewer draws — save it with the
snapshot when storing a run, since no snapshot carries it.

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

Defined in: [src/core/RunnerBase.ts:209](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L209)

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

Defined in: [src/core/RunnerBase.ts:253](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L253)

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

### listenerCount()

> **listenerCount**(`type?`): `number`

Defined in: [src/core/RunnerBase.ts:502](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L502)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`listenerCount`](/agentfootprint/api/generated/classes/RunnerBase.md#listenercount)

***

### off()

#### Call Signature

> **off**\<`K`\>(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:445](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L445)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`off`](/agentfootprint/api/generated/classes/RunnerBase.md#off)

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:446](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L446)

##### Parameters

###### type

`WildcardSubscription`

###### listener

`WildcardListener`

##### Returns

`void`

##### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`off`](/agentfootprint/api/generated/classes/RunnerBase.md#off)

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:422](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L422)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`on`](/agentfootprint/api/generated/classes/RunnerBase.md#on)

#### Call Signature

> **on**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:427](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L427)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`on`](/agentfootprint/api/generated/classes/RunnerBase.md#on)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:456](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L456)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`once`](/agentfootprint/api/generated/classes/RunnerBase.md#once)

#### Call Signature

> **once**(`type`, `listener`, `options?`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:461](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L461)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`once`](/agentfootprint/api/generated/classes/RunnerBase.md#once)

***

### removeAllListeners()

> **removeAllListeners**(): `void`

Defined in: [src/core/RunnerBase.ts:492](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L492)

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

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`removeAllListeners`](/agentfootprint/api/generated/classes/RunnerBase.md#removealllisteners)

***

### resume()

> **resume**(`checkpoint`, `input?`, `options?`): `Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

Defined in: [src/core-flow/Workflow.ts:175](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L175)

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

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`resume`](/agentfootprint/api/generated/classes/RunnerBase.md#resume)

***

### run()

> **run**(`input`, `options?`): `Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

Defined in: [src/core-flow/Workflow.ts:168](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core-flow/Workflow.ts#L168)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

`TIn`

##### options?

`RunOptions`

#### Returns

`Promise`\<[`RunnerPauseOutcome`](/agentfootprint/api/generated/interfaces/RunnerPauseOutcome.md) \| `TOut`\>

#### Overrides

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`run`](/agentfootprint/api/generated/classes/RunnerBase.md#run)

***

### shutdown()

> **shutdown**(`options?`): `Promise`\<`void`\>

Defined in: [src/core/RunnerBase.ts:614](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/RunnerBase.ts#L614)

Drain and release what was enabled on this runner.

**The agent itself remains usable afterwards; `shutdown()` drains and
releases what was enabled on it.** Nothing about the runner is destroyed:
`run()` still works, listeners still fire, and enabling telemetry again
gives you a fresh, live handle.

The order is the part worth having in one place:

  1. every handle FLUSHES first — including the events still queued on a
     `detach` driver, which have not reached the strategy yet;
  2. only then does anything stop, so a strategy shared by two handles is
     fully drained before either releases it;
  3. a strategy is stopped only once nothing is still subscribed to it,
     and at most once ever (see `strategies/lifecycle.ts`).

#### Parameters

##### options?

###### stop?

`boolean`

Default `true`. Pass `false` to drain WITHOUT
  releasing — what a host does when it is shutting down but does not own
  the agent it was handed (`standingAgent`'s default `shutdown: 'flush'`).

#### Returns

`Promise`\<`void`\>

#### Example

```ts
Graceful exit for a script
  const telemetry = agent.enable.observability({ strategy: cloudwatch });
  const answer = await agent.run({ message: 'hi' });
  await agent.shutdown();
```

#### Inherited from

[`RunnerBase`](/agentfootprint/api/generated/classes/RunnerBase.md).[`shutdown`](/agentfootprint/api/generated/classes/RunnerBase.md#shutdown)
