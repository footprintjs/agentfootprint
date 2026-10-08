---
title: Loop
---

# Class: Loop

Defined in: [src/core-flow/Loop.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L104)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/docs/api/classes/RunnerBase)\<[`LoopInput`](/docs/api/interfaces/LoopInput), [`LoopOutput`](/docs/api/type-aliases/LoopOutput)\>

## Constructors

### Constructor

> **new Loop**(`opts`, `body`, `config`): `Loop`

Defined in: [src/core-flow/Loop.ts:122](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L122)

#### Parameters

##### opts

[`LoopOptions`](/docs/api/interfaces/LoopOptions)

##### body

`BodyChild`

##### config

###### bodyTranslator?

[`GroupTranslator`](/docs/api/interfaces/GroupTranslator)\<`unknown`\>

###### maxIterations

`number`

###### maxWallclockMs?

`number`

###### until?

[`UntilGuard`](/docs/api/type-aliases/UntilGuard)

#### Returns

`Loop`

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`constructor`](/docs/api/classes/RunnerBase#constructor)

## Properties

### enable

> `readonly` **enable**: [`EnableNamespace`](/docs/api/interfaces/EnableNamespace)

Defined in: [src/core/RunnerBase.ts:890](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L890)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`enable`](/docs/api/classes/RunnerBase#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core-flow/Loop.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L106)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core-flow/Loop.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L105)

## Methods

### attach()

> **attach**(`recorder`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:703](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L703)

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

WHEN it starts observing: the NEXT run. Recorders are handed to the
executor when the executor is built, at run start, so one attached WHILE
a run is in flight sees nothing of that run and everything of the one
after — it is not dropped, it is early. Between runs (or before the
first) is the ordinary case and works exactly as it reads. Event
listeners are the opposite: `on()` takes effect immediately, but only for
events emitted after it, so a listener added mid-run sees the rest of
that run and none of its beginning.

#### Parameters

##### recorder

[`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)

#### Returns

`Unsubscribe`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`attach`](/docs/api/classes/RunnerBase#attach)

***

### closeToolSessions()

> **closeToolSessions**(`options?`): `Promise`\<`number`\>

Defined in: [src/core/RunnerBase.ts:874](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L874)

End the tool sessions held for one hosting session.
Pass `{ scope: 'run', sessionId }` to terminate only its paused turn's
resources, such as after an explicit input cancellation. Session-scoped
resources and other conversations remain open.

**The mechanism is the library's; the TIMING is yours.** Nothing in this
package can know when a request/reply session is over — a `HostRequest`
carries a `sessionId` and no end, `SessionLifecycle` is `hydrate`/`persist`
by design (a TTL, a scan or a delete is the STORE's own API, not a demand
this port makes of every store that will ever implement it), and AWS itself
does not tell you: an idle timeout is the reality. Guessing a boundary here
would tear down a live sandbox mid-conversation.

So the composition root, which already owns the shape of the process, says
when — the same doctrine that stops `shutdownOn` from grabbing signals by
default. On the conversation door that is one line:

```ts
conversation.onClose(() => void agent.closeToolSessions({ sessionId }));
```

A request/reply deployment that knows its own boundary — a logout, a job
finishing, a cart abandoned — calls the same method.

Never calling it is survivable, not silent: sessions idle out on the tier's
lazy sweep, a bounded live count evicts the coldest, and `shutdown()` takes
whatever is left.

#### Parameters

##### options?

\{ `reason?`: [`TeardownReason`](/docs/api/type-aliases/TeardownReason); `scope?`: `"session"`; `sessionId?`: `string`; \} \| \{ `scope`: `"run"`; `sessionId`: `string`; \}

#### Returns

`Promise`\<`number`\>

how many cleanups ran. `0` when this runner holds none — a
  composition, or an agent whose tools never opened anything.

#### Example

```ts
host.onSessionEnd(async (sessionId) => {
    const closed = await agent.closeToolSessions({ sessionId });
    log.info({ sessionId, closed }, 'tool sessions released');
  });
```

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`closeToolSessions`](/docs/api/classes/RunnerBase#closetoolsessions)

***

### create()

> `static` **create**(`opts?`): [`LoopBuilder`](/docs/api/classes/LoopBuilder)

Defined in: [src/core-flow/Loop.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L150)

#### Parameters

##### opts?

[`LoopOptions`](/docs/api/interfaces/LoopOptions) = `{}`

#### Returns

[`LoopBuilder`](/docs/api/classes/LoopBuilder)

***

### emit()

> **emit**(`name`, `payload`): `void`

Defined in: [src/core/RunnerBase.ts:939](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L939)

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

### getCommitCount()

> **getCommitCount**(): `number`

Defined in: [src/core/RunnerBase.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L282)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getCommitCount`](/docs/api/classes/RunnerBase#getcommitcount)

***

### getLastSnapshot()

> **getLastSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:172](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L172)

Returns the footprintjs snapshot from the most recent run. The snapshot is
the CANONICAL STRUCTURE: nodes, edges, executionTree, runtimeStageId,
commitLog.

Domain consumers (Lens, Trace, dashboards) read this for shape
and join their own per-stage payload by `runtimeStageId`. They
MUST NOT re-derive structure from typed events — that's the
design footprintjs's CLAUDE.md Convention 1 explicitly forbids.

`undefined` before the first `run()` has STARTED. After that it is the
most recent run's snapshot, including across multi-turn reuse of the same
runner instance.

**Live during a run.** The executor is assigned at run start, so a caller
reading this from inside a run — an event listener, a tool, a recorder —
gets the IN-FLIGHT snapshot, partially filled, not the last completed one.
[RunnerBase.getSnapshot](/docs/api/classes/RunnerBase#getsnapshot) is the same value under the name that says
so. Anything that must describe a FINISHED run has to capture at the
terminal flush instead of polling this.

**Served, under a redaction policy.** When the run was covered by one
(`Agent.create({ redact })`, a composed member's, or one a calling tool
handed down), this is footprintjs's REDACTED view —
`getSnapshot({ redact: true })`, through `servableSnapshot`, the one owner
of what a run may show: `sharedState` and every subflow's state from the
redacted mirror, the commit log as scrubbed at write time, and no
`initialState` (the raw pre-run base never passed the policy, so a fold of
it reports `basis: 'log-only'`). Without a policy it is the snapshot
exactly as footprintjs builds it. The library's own logic never reads this
getter — what it computes on is the live run (`liveSnapshot`).

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getLastSnapshot`](/docs/api/classes/RunnerBase#getlastsnapshot)

***

### getSnapshot()

> **getSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L260)

Alias for `getLastSnapshot()` that mirrors `FlowChartExecutor.getSnapshot()`
so consumers (lens, playground, ExplainableShell) can read the live or
just-completed snapshot through the same method name they'd use on a
footprintjs executor — without having to know whether they're holding
an agentfootprint Runner or a raw executor.

During an active run, returns the in-progress snapshot (commit log +
execution tree built incrementally as stages execute). Between runs,
returns the last completed run's snapshot. Undefined before any run has
started. Served exactly as `getLastSnapshot()` is: under the run's
redaction policy, the placeholder where a selected value was.

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getSnapshot`](/docs/api/classes/RunnerBase#getsnapshot)

***

### getSpec()

> **getSpec**(): `FlowChart`

Defined in: [src/core/RunnerBase.ts:305](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L305)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getSpec`](/docs/api/classes/RunnerBase#getspec)

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L341)

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

Defined in: [src/core/RunnerBase.ts:385](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L385)

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

Defined in: [src/core/RunnerBase.ts:667](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L667)

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

Defined in: [src/core/RunnerBase.ts:610](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L610)

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

Defined in: [src/core/RunnerBase.ts:611](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L611)

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

Defined in: [src/core/RunnerBase.ts:587](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L587)

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

Defined in: [src/core/RunnerBase.ts:592](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L592)

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

Defined in: [src/core/RunnerBase.ts:621](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L621)

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

Defined in: [src/core/RunnerBase.ts:626](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L626)

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

Defined in: [src/core/RunnerBase.ts:657](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L657)

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

Defined in: [src/core-flow/Loop.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L204)

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

Defined in: [src/core-flow/Loop.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Loop.ts#L190)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

`string` \| [`LoopInput`](/docs/api/interfaces/LoopInput)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`run`](/docs/api/classes/RunnerBase#run)

***

### shutdown()

> **shutdown**(`options?`): `Promise`\<`void`\>

Defined in: [src/core/RunnerBase.ts:788](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L788)

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

[`RunnerBase`](/docs/api/classes/RunnerBase).[`shutdown`](/docs/api/classes/RunnerBase#shutdown)
