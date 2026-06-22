---
title: Agent
---

# Class: Agent

Defined in: [src/core/Agent.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L123)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/docs/api/classes/RunnerBase)\<[`AgentInput`](/docs/api/interfaces/AgentInput), [`AgentOutput`](/docs/api/type-aliases/AgentOutput)\>

## Constructors

### Constructor

> **new Agent**(`opts`, `systemPromptValue`, `registry`, `voice`, `injections?`, `memories?`, `outputSchemaParser?`, `toolProvider?`, `systemPromptCachePolicy?`, `cachingDisabled?`, `cacheStrategy?`, `outputFallbackCfg?`, `reliabilityConfig?`, `thinkingHandlerValue?`, `thinkingBudgetValue?`, `skillGraphNextSkill?`, `skillGraphReachable?`, `skillGraphScoreEntries?`): `Agent`

Defined in: [src/core/Agent.ts:307](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L307)

#### Parameters

##### opts

[`AgentOptions`](/docs/api/interfaces/AgentOptions)

##### systemPromptValue

`string`

##### registry

readonly [`ToolRegistryEntry`](/docs/api/interfaces/ToolRegistryEntry)[]

##### voice

###### appName

`string`

###### commentaryTemplates

`Readonly`\<`Record`\<`string`, `string`\>\>

###### thinkingTemplates

`Readonly`\<`Record`\<`string`, `string`\>\>

##### injections?

readonly [`Injection`](/docs/api/interfaces/Injection)[] = `[]`

##### memories?

readonly [`MemoryDefinition`](/docs/api/interfaces/MemoryDefinition)\<`unknown`\>[] = `[]`

##### outputSchemaParser?

[`OutputSchemaParser`](/docs/api/interfaces/OutputSchemaParser)\<`unknown`\>

##### toolProvider?

[`ToolProvider`](/docs/api/interfaces/ToolProvider)

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

##### skillGraphNextSkill?

(`ctx`) => `string` \| `undefined`

##### skillGraphReachable?

(`currentSkillId?`) => readonly `string`[]

##### skillGraphScoreEntries?

(`ctx`, `signal?`) => `Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>

#### Returns

`Agent`

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`constructor`](/docs/api/classes/RunnerBase#constructor)

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/core/Agent.ts:208](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L208)

Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
`appName` is the active actor in narration ("Chatbot called…").
`commentaryTemplates` drives Lens's third-person panel.
`thinkingTemplates` drives chat-bubble first-person status.
Defaults to bundled English; consumer overrides via builder.

***

### commentaryTemplates

> `readonly` **commentaryTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L209)

***

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

Defined in: [src/core/Agent.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L125)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/Agent.ts:124](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L124)

***

### thinkingTemplates

> `readonly` **thinkingTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L210)

## Methods

### attach()

> **attach**(`recorder`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

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

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`attach`](/docs/api/classes/RunnerBase#attach)

***

### create()

> `static` **create**(`opts`): [`AgentBuilder`](/docs/api/classes/AgentBuilder)

Defined in: [src/core/Agent.ts:432](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L432)

#### Parameters

##### opts

[`AgentOptions`](/docs/api/interfaces/AgentOptions)

#### Returns

[`AgentBuilder`](/docs/api/classes/AgentBuilder)

***

### drainObservers()

> **drainObservers**(`opts?`): `Promise`\<`DrainResult`\>

Defined in: [src/core/Agent.ts:879](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L879)

Flush the deferred-observer backlog of the most recent run's executor,
then await async listener completions under a deadline (RFC-001 §11 —
the serverless / graceful-shutdown pattern). Resolves immediately with
zeros before the first run or when `observerDelivery` is `'inline'`
and no recorder opted into `'deferred'` itself.

`pending === 0` means a full drain; non-zero honestly reports
continuations still outstanding at the deadline — never silent loss.

#### Parameters

##### opts?

###### timeoutMs?

`number`

#### Returns

`Promise`\<`DrainResult`\>

#### Example

```ts
export const handler = async (event) => {
  const reply = await agent.run({ message: event.message });
  // settle "one beat behind" observer work BEFORE the freeze:
  await agent.drainObservers({ timeoutMs: 5_000 });
  return reply;
};
```

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

### getLastNarrativeEntries()

> **getLastNarrativeEntries**(): readonly `CombinedNarrativeEntry`[]

Defined in: [src/core/Agent.ts:467](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L467)

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

Defined in: [src/core/Agent.ts:456](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L456)

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

### getSystemPromptCachePolicy()

> **getSystemPromptCachePolicy**(): `CachePolicy`

Defined in: [src/core/Agent.ts:442](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L442)

Cache policy for the base system prompt. Read by the CacheDecision
subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
cache markers. Exposed as a method (not direct field access) so
the Agent's encapsulation boundary stays clean.

#### Returns

`CachePolicy`

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

keyof AgentfootprintEventMap \| [`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

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

`K` *extends* keyof [`AgentfootprintEventMap`](/docs/api/interfaces/AgentfootprintEventMap)

##### Parameters

###### type

`K`

###### listener

[`EventListener`](/docs/api/type-aliases/EventListener)\<`K`\>

##### Returns

`void`

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`off`](/docs/api/classes/RunnerBase#off)

#### Call Signature

> **off**(`type`, `listener`): `void`

Defined in: [src/core/RunnerBase.ts:391](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L391)

##### Parameters

###### type

[`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

###### listener

[`WildcardListener`](/docs/api/type-aliases/WildcardListener)

##### Returns

`void`

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`off`](/docs/api/classes/RunnerBase#off)

***

### on()

#### Call Signature

> **on**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/core/RunnerBase.ts:367](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L367)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`on`](/docs/api/classes/RunnerBase#on)

#### Call Signature

> **on**(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/core/RunnerBase.ts:372](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L372)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`on`](/docs/api/classes/RunnerBase#on)

***

### once()

#### Call Signature

> **once**\<`K`\>(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/core/RunnerBase.ts:401](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L401)

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

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`once`](/docs/api/classes/RunnerBase#once)

#### Call Signature

> **once**(`type`, `listener`, `options?`): [`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

Defined in: [src/core/RunnerBase.ts:406](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L406)

##### Parameters

###### type

[`WildcardSubscription`](/docs/api/type-aliases/WildcardSubscription)

###### listener

[`WildcardListener`](/docs/api/type-aliases/WildcardListener)

###### options?

`Omit`\<[`ListenOptions`](/docs/api/interfaces/ListenOptions), `"once"`\>

##### Returns

[`Unsubscribe`](/docs/api/type-aliases/Unsubscribe)

##### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`once`](/docs/api/classes/RunnerBase#once)

***

### parseOutput()

> **parseOutput**\<`T`\>(`raw`): `T`

Defined in: [src/core/Agent.ts:522](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L522)

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

Defined in: [src/core/Agent.ts:542](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L542)

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

Defined in: [src/core/Agent.ts:754](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L754)

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

### resumeOnError()

> **resumeOnError**(`checkpoint`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/Agent.ts:711](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L711)

Resume an agent run from a checkpoint produced by a prior
`RunCheckpointError`. Unlike `agent.resume()` (which takes a
`FlowchartCheckpoint` from an intentional pause), this takes
an `AgentRunCheckpoint` (conversation-history snapshot) and
replays the agent run with that history restored.

The next iteration retries the call that originally failed —
with the latest provider state (circuit breaker may have
closed, vendor may have recovered, etc.).

**Resume = REPLAY from the last completed iteration boundary,
not exact-state restore.** Only the conversation history is
restored; everything else re-seeds fresh:

  - **Tool re-execution / idempotency**: tool side effects from
    the FAILED iteration are not in the checkpoint. The model
    re-decides from the restored history and may re-issue those
    tool calls — they WILL execute again (there is no built-in
    toolCallId dedup). Mutating tools (payments, emails, DB
    writes) must be idempotent — key on stable call content, not
    `ctx.toolCallId` (a re-issued call gets a new id).
  - **Fresh `runId`**: the resumed run's events carry a new
    `runId`; use `checkpoint.runId` to correlate back to the
    failing run.
  - **Iteration counter + budget reset**: the resumed run starts
    at iteration 1 with a full `maxIterations` budget
    (`checkpoint.lastCompletedIteration` is diagnostic only).
    Token/cost accumulators also restart at zero.

#### Parameters

##### checkpoint

`unknown`

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

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

> **run**(`input`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/Agent.ts:606](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L606)

Execute the runner. Subclass may override for specialized input
mapping, but default invokes getSpec() + FlowChartExecutor.

#### Parameters

##### input

[`AgentInput`](/docs/api/interfaces/AgentInput)

##### options?

`RunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`run`](/docs/api/classes/RunnerBase#run)

***

### runTyped()

> **runTyped**\<`T`\>(`input`, `options?`): `Promise`\<`T`\>

Defined in: [src/core/Agent.ts:589](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L589)

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

[`AgentInput`](/docs/api/interfaces/AgentInput)

##### options?

`RunOptions`

#### Returns

`Promise`\<`T`\>
