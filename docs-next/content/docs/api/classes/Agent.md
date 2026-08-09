---
title: Agent
---

# Class: Agent

Defined in: [src/core/Agent.ts:223](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L223)

Every primitive (LLMCall, Agent), every composition (Sequence, Parallel,
Conditional, Loop), and every pattern factory result implements Runner.
That makes them freely nestable: any runner can be a child of any
composition.

## Extends

- [`RunnerBase`](/docs/api/classes/RunnerBase)\<[`AgentInput`](/docs/api/interfaces/AgentInput), [`AgentOutput`](/docs/api/type-aliases/AgentOutput)\>

## Constructors

### Constructor

> **new Agent**(`opts`, `systemPromptValue`, `registry`, `voice`, `injections?`, `memories?`, `outputSchemaParser?`, `toolProvider?`, `systemPromptCachePolicy?`, `cachingDisabled?`, `cacheStrategy?`, `outputFallbackCfg?`, `reliabilityConfig?`, `thinkingHandlerValue?`, `thinkingBudgetValue?`, `skillGraphNextSkill?`, `skillGraphReachable?`, `skillGraphScoreEntries?`, `checkInOptions?`, `runConfigFn?`, `windowStrategy?`, `toolMiddleware?`, `messageMiddleware?`, `outputEnforcement?`, `skillGraphEdgeTargets?`, `skillGraphExplainNextSkill?`, `skillGraphIsTree?`, `skillGraphSupersededEntries?`): `Agent`

Defined in: [src/core/Agent.ts:528](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L528)

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

readonly `Injection`[] = `[]`

##### memories?

readonly `MemoryDefinition`\<`unknown`\>[] = `[]`

##### outputSchemaParser?

[`OutputSchemaParser`](/docs/api/interfaces/OutputSchemaParser)\<`unknown`\>

##### toolProvider?

`ToolProvider`

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

(`ctx`, `signal?`) => `Promise`\<`EntryScoring`\>

##### checkInOptions?

[`CheckInBuilderOptions`](/docs/api/interfaces/CheckInBuilderOptions)

##### runConfigFn?

`RunConfigFn`

##### windowStrategy?

[`WindowStrategy`](/docs/api/interfaces/WindowStrategy)

##### toolMiddleware?

readonly [`ToolMiddleware`](/docs/api/type-aliases/ToolMiddleware)[]

##### messageMiddleware?

readonly [`MessageMiddleware`](/docs/api/interfaces/MessageMiddleware)[]

##### outputEnforcement?

`ResolvedOutputEnforcement`

##### skillGraphEdgeTargets?

readonly `string`[]

##### skillGraphExplainNextSkill?

(`ctx`) => `CursorMove`

##### skillGraphIsTree?

`boolean`

##### skillGraphSupersededEntries?

(`ctx`) => readonly `string`[]

#### Returns

`Agent`

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`constructor`](/docs/api/classes/RunnerBase#constructor)

## Properties

### appName

> `readonly` **appName**: `string`

Defined in: [src/core/Agent.ts:379](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L379)

Voice config — shared by viewers (Lens, ChatThinkKit, CLI tail).
`appName` is the active actor in narration ("Chatbot called…").
`commentaryTemplates` drives Lens's third-person panel.
`thinkingTemplates` drives chat-bubble first-person status.
Defaults to bundled English; consumer overrides via builder.

***

### commentaryTemplates

> `readonly` **commentaryTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:380](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L380)

***

### enable

> `readonly` **enable**: [`EnableNamespace`](/docs/api/interfaces/EnableNamespace)

Defined in: [src/core/RunnerBase.ts:649](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L649)

Enable-namespace for high-level observability features. Each method
attaches a pre-built CombinedRecorder and returns an unsubscribe
function. Consumers write ONE line to enable rich observability,
instead of N `.on()` subscriptions.

#### Inherited from

[`RunnerBase`](/docs/api/classes/RunnerBase).[`enable`](/docs/api/classes/RunnerBase#enable)

***

### id

> `readonly` **id**: `string`

Defined in: [src/core/Agent.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L225)

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/Agent.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L224)

***

### thinkingTemplates

> `readonly` **thinkingTemplates**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/core/Agent.ts:381](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L381)

## Methods

### abandonPause()

> **abandonPause**(): \{ `question?`: `string`; `toolCallId?`: `string`; `toolName?`: `string`; \} \| `undefined`

Defined in: [src/core/Agent.ts:1155](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1155)

Drop the question this agent's last run paused to ask, on the record.

A paused run is waiting on a person. Sending a different message while one
is outstanding is refused ([PendingQuestionError](/docs/api/classes/PendingQuestionError)) because silently
discarding a pending question makes a consent gate something any later
message can walk around. When the question really is being dropped —
the user changed the subject, the session timed out, the approval is no
longer wanted — say so with this, and the next `run()` proceeds.

Returns what was dropped (`undefined` when nothing was pending), so a
caller can log or audit the abandonment rather than perform it blind. It
does not touch the paused run's checkpoint: if you still hold that, it
remains resumable.

#### Returns

\{ `question?`: `string`; `toolCallId?`: `string`; `toolName?`: `string`; \} \| `undefined`

***

### attach()

> **attach**(`recorder`): `Unsubscribe`

Defined in: [src/core/RunnerBase.ts:545](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L545)

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

### canExplain()

> **canExplain**(): `boolean`

Defined in: [src/core/Agent.ts:1177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1177)

Whether Agent.selfExplain's why-questions have a run to answer
from right now.

`false` for two different reasons, both honest: this agent was not built
with `.selfExplain()`, or it was and no turn has completed yet (evidence
binds at the END of a run, never to the one in flight). Either way there
is nothing to explain, which is what a caller routing a why-question needs
to know before it routes.

The model is told the same thing by the same fact — the trace tools answer
"No completed run is available yet" and the skill body says to say so
plainly. This is that answer, for the program.

#### Returns

`boolean`

***

### checkpoint()

> **checkpoint**(): [`AgentRunCheckpoint`](/docs/api/interfaces/AgentRunCheckpoint) \| `undefined`

Defined in: [src/core/Agent.ts:1427](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1427)

The conversation this agent's LAST completed run leaves behind, packed as
the same `AgentRunCheckpoint` that `resumeOnError(...)` accepts. Store it,
hand it back next turn, and the agent continues where it left off — across
a restart, a deploy, or a different machine.

Returns `undefined` before any run has completed.

**Read from the run's own recording, not from a second copy.** The history
comes from `getLastSnapshot().sharedState.history` — the state the run
actually committed — cloned on the way out so a persistence layer can never
mutate the live heap. The final assistant turn is appended from the answer
`run()` returned, because nothing ever writes it back into `history`: the
loop appends assistant turns only when they carry tool calls, and the turn
that ends the run carries none. An agent that stored this conversation
without that append would drop its own reply every turn and answer the next
one having forgotten what it just said.

Adds no events, no scope writes and no capture: every recording is
byte-identical to an agent that never calls this.

After a run that **paused**, this is the conversation as of the pause, with
no answer appended — a pause is unfinished work, and pause/resume has its
own carrier (`FlowchartCheckpoint`) that holds engine state this shape
cannot.

The conversation grows every turn and nothing here trims it. Bounding what
the model is shown is the memory subsystem's job (`.memory(...)`), not a
silent cap applied on the way to storage.

#### Returns

[`AgentRunCheckpoint`](/docs/api/interfaces/AgentRunCheckpoint) \| `undefined`

#### Example

```ts
await agent.run({ message: 'Book me a table for two.' });
const conversation = agent.checkpoint();          // persist anywhere
// …a restart later, on a fresh Agent:
await agent.resumeOnError({
  ...conversation,
  history: [...conversation.history, { role: 'user', content: 'Make it three.' }],
  originalInput: { message: 'Make it three.' },
});
```

***

### create()

> `static` **create**(`opts`): [`AgentBuilder`](/docs/api/classes/AgentBuilder)

Defined in: [src/core/Agent.ts:718](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L718)

#### Parameters

##### opts

[`AgentOptions`](/docs/api/interfaces/AgentOptions)

#### Returns

[`AgentBuilder`](/docs/api/classes/AgentBuilder)

***

### drainObservers()

> **drainObservers**(`opts?`): `Promise`\<`DrainResult`\>

Defined in: [src/core/Agent.ts:1926](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1926)

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

**Lambda-style handler**

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

Defined in: [src/core/RunnerBase.ts:697](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L697)

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

### followUp()

> **followUp**(`message`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/Agent.ts:1123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1123)

Continue this agent's own last completed conversation.

The one-liner for turn two and after. `run()` is one turn and starts a new
conversation each time (see [Agent.run](/docs/api/classes/Agent#run)); this reads the
conversation off the last completed run, appends `message` as the next
user turn, and runs from there — so the model sees what was actually said.

Sugar over `run({ message, continueFrom: this.checkpoint() })` and nothing
more: one restoration path, so the convenience cannot drift from the
mechanism. Reach for `run({ continueFrom })` directly when the
conversation comes from somewhere other than this instance's last run — a
store, another process, a different machine.

Refuses rather than guessing: [NoConversationError](/docs/api/classes/NoConversationError) when this agent
has no completed run to continue (a "follow-up" that quietly became a
first turn would be exactly the confusion this door exists to remove),
and — through `run()` — [PendingQuestionError](/docs/api/classes/PendingQuestionError) when the last run
paused to ask a person something, because a pause has its own door:
`resume(checkpoint, decision)`.

The conversation grows every turn and nothing here trims it; bounding what
the model is shown is `.window()` / `.compaction()` / `.memory()`, not a
silent cap on the way through.

#### Parameters

##### message

`string`

##### options?

`AgentRunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Example

```ts
await agent.run({ message: 'Book me a table for two.' });
await agent.followUp('Make it three.');
await agent.followUp('And move it to 8pm.');
```

***

### getCommitCount()

> **getCommitCount**(): `number`

Defined in: [src/core/RunnerBase.ts:157](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L157)

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

### getLastNarrativeEntries()

> **getLastNarrativeEntries**(): readonly `CombinedNarrativeEntry`[]

Defined in: [src/core/Agent.ts:761](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L761)

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

Defined in: [src/core/Agent.ts:750](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L750)

The footprintjs `RuntimeSnapshot` from the most recent `run()` /
`resume()`. Feeds Lens's Trace tab (ExplainableShell `runtimeSnapshot`
prop) so consumers can scrub the execution timeline post-run without
threading a recorder through the call site.

`undefined` until a run has STARTED. After that it is the most recent
run's snapshot — including across multiple turns of the same instance.

**It is LIVE during a run, not a completed-runs-only view.** The executor
is assigned at run start, so calling this from an event listener, a tool,
or any other mid-run vantage point returns the IN-FLIGHT run, partially
filled. That is deliberate (Lens scrubs a running agent through it), and
it is why `.selfExplain()` captures at the terminal flush instead of
resolving through this: evidence that is supposed to describe a FINISHED
turn cannot be read from a getter that also answers about an unfinished
one.

#### Returns

`RuntimeSnapshot` \| `undefined`

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`getLastSnapshot`](/docs/api/classes/RunnerBase#getlastsnapshot)

***

### getSnapshot()

> **getSnapshot**(): `RuntimeSnapshot` \| `undefined`

Defined in: [src/core/RunnerBase.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L135)

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

Defined in: [src/core/RunnerBase.ts:180](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L180)

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

### getSystemPromptCachePolicy()

> **getSystemPromptCachePolicy**(): `CachePolicy`

Defined in: [src/core/Agent.ts:728](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L728)

Cache policy for the base system prompt. Read by the CacheDecision
subflow (v2.6 Phase 4) to know how to treat the SystemPrompt slot's
cache markers. Exposed as a method (not direct field access) so
the Agent's encapsulation boundary stays clean.

#### Returns

`CachePolicy`

***

### getUIGroup()

> **getUIGroup**\<`T`\>(): `T` \| `undefined`

Defined in: [src/core/RunnerBase.ts:216](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L216)

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

Defined in: [src/core/RunnerBase.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L260)

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

Defined in: [src/core/RunnerBase.ts:509](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L509)

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

Defined in: [src/core/RunnerBase.ts:452](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L452)

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

Defined in: [src/core/RunnerBase.ts:453](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L453)

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

Defined in: [src/core/RunnerBase.ts:429](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L429)

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

Defined in: [src/core/RunnerBase.ts:434](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L434)

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

Defined in: [src/core/RunnerBase.ts:463](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L463)

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

Defined in: [src/core/RunnerBase.ts:468](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L468)

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

### outputContractUnmet()

> **outputContractUnmet**(): \{ `attempts`: `number`; `brokenBy?`: `string`; `error`: `string`; `fallbackConfigured`: `boolean`; `path?`: `string`; `retriesSpent`: `number`; `stage`: `"json-parse"` \| `"schema-validate"`; \} \| `undefined`

Defined in: [src/core/Agent.ts:2006](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L2006)

Did the last turn's answer FAIL this agent's `outputSchema` — and how (8.18.0)?

`undefined` when the answer satisfied the contract, and on any agent with
no `.outputSchema()`. Set on every run whose final answer was judged and
rejected, including the default `retries: 0` case where the first answer is
the only one there was.

## Why a method, when `runTyped()` already throws

Because `run()` does not, and `run()` is what a server, a queue worker and
`standingAgent` call. Before this existed, that caller received a string
that violated a contract they had declared, with nothing anywhere saying
so: the retries were billed, the ledger row was written under `retries > 0`
and absent under `retries: 0`, and the answer looked exactly like a good
one. `runTyped()` still throws `OutputSchemaError` — that is the caller
ASKING to be raised at, and it is unchanged.

`brokenBy` is the case worth a dashboard: the model's answer PASSED and one
of your own `act({ output })` rules rewrote it into one that fails. The run
stops re-asking when that happens — a deterministic rule breaks the next
answer identically, so the retries would be bought for nothing.

#### Returns

##### Type Literal

\{ `attempts`: `number`; `brokenBy?`: `string`; `error`: `string`; `fallbackConfigured`: `boolean`; `path?`: `string`; `retriesSpent`: `number`; `stage`: `"json-parse"` \| `"schema-validate"`; \}

###### attempts

> `readonly` **attempts**: `number`

Answers actually judged, first one included. `1` under `retries: 0`.

###### brokenBy?

> `readonly` `optional` **brokenBy?**: `string`

Set when an `act({ output })` middleware's own rewrite broke an answer
 that HAD satisfied the schema — the name of that middleware.

###### error

> `readonly` **error**: `string`

The validator's own message, verbatim. DATA, not narrative.

###### fallbackConfigured

> `readonly` **fallbackConfigured**: `boolean`

True when `.outputFallback()` is configured — in which case a tier
 exists that `run()` never reaches and `runTyped()` does.

###### path?

> `readonly` `optional` **path?**: `string`

Failing field path when the parser exposes one (Zod-style issues).

###### retriesSpent

> `readonly` **retriesSpent**: `number`

Corrective re-asks the run paid for. `0` under `retries: 0`.

###### stage

> `readonly` **stage**: `"json-parse"` \| `"schema-validate"`

Which half of validation failed.

***

`undefined`

#### Example

```ts
const answer = await agent.run({ message: 'summarise ticket 91' });
const unmet = agent.outputContractUnmet();
if (unmet) {
  log.warn({ stage: unmet.stage, error: unmet.error, brokenBy: unmet.brokenBy });
  return safeDefault;               // …rather than shipping `answer` as typed data
}
```

***

### parseOutput()

> **parseOutput**\<`T`\>(`raw`): `T`

Defined in: [src/core/Agent.ts:816](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L816)

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

Defined in: [src/core/Agent.ts:836](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L836)

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

Defined in: [src/core/RunnerBase.ts:499](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L499)

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

Defined in: [src/core/Agent.ts:1336](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1336)

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

`AgentRunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`resume`](/docs/api/classes/RunnerBase#resume)

***

### resumeOnError()

> **resumeOnError**(`checkpoint`, `options?`): `Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

Defined in: [src/core/Agent.ts:1225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1225)

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

`AgentRunOptions`

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

Defined in: [src/core/Agent.ts:953](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L953)

Answer one turn.

**`run()` is ONE turn, and it starts a new conversation every time.** The
chart seeds its history from this call's `message` alone, so a second
`run()` on the same agent does not continue the first: the model is shown
one user message and will honestly tell your user it has not spoken to
them before. That is deliberate — a primitive that quietly accumulated
state across calls could never be used for one-shot work, and a hidden
transcript is the most expensive thing an agent can carry.

To continue a conversation, name it:

  - `agent.followUp(message)` — continue THIS agent's own last completed
    run. The one-liner, and what most callers want.
  - `run({ message, continueFrom })` — continue a conversation you are
    holding: `agent.checkpoint()` from an earlier turn, persisted anywhere
    and handed back. Works across a restart, a deploy, or a different
    machine, and is what `standingAgent` uses per session.

Passing the same `identity.conversationId` to two `run()` calls does NOT
continue anything — see [AgentInput.identity](/docs/api/interfaces/AgentInput#identity). What a registered
memory adds is *recall* of prior turns into the system-prompt slot, which
is a different thing from the conversation itself.

Two refusals guard the per-instance state this agent keeps; both replace
behavior that used to succeed while quietly being wrong (9.2.0):
[RunInFlightError](/docs/api/classes/RunInFlightError) when a run is already in flight, and
[PendingQuestionError](/docs/api/classes/PendingQuestionError) when the last run paused to ask a person
something that nobody has answered.

#### Parameters

##### input

`string` \| [`AgentInput`](/docs/api/interfaces/AgentInput)

##### options?

`AgentRunOptions`

#### Returns

`Promise`\<`string` \| [`RunnerPauseOutcome`](/docs/api/interfaces/RunnerPauseOutcome)\>

#### Example

**One turn, then a follow-up**

```ts
await agent.run({ message: 'Book me a table for two.' });
await agent.followUp('Make it three.');       // remembers the table
```

#### Overrides

[`RunnerBase`](/docs/api/classes/RunnerBase).[`run`](/docs/api/classes/RunnerBase#run)

***

### runTyped()

> **runTyped**\<`T`\>(`input`, `options?`): `Promise`\<`T`\>

Defined in: [src/core/Agent.ts:899](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L899)

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

`string` \| [`AgentInput`](/docs/api/interfaces/AgentInput)

##### options?

`AgentRunOptions`

#### Returns

`Promise`\<`T`\>

***

### shutdown()

> **shutdown**(`options?`): `Promise`\<`void`\>

Defined in: [src/core/RunnerBase.ts:630](https://github.com/footprintjs/agentfootprint/blob/main/src/core/RunnerBase.ts#L630)

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

***

### stoppedEarly()

> **stoppedEarly**(): \{ `answerWasEmpty`: `boolean`; `iteration`: `number`; `pendingToolCalls`: `number`; `reason`: `"max-iterations"` \| `"cost-budget"`; \} \| `undefined`

Defined in: [src/core/Agent.ts:1966](https://github.com/footprintjs/agentfootprint/blob/main/src/core/Agent.ts#L1966)

Did the last turn stop because a LIMIT cut it short — and if so, which?

`undefined` on every normal finish, including a turn that used its whole
`maxIterations` budget and then genuinely finished. It is set only when
the model was still asking for tools and the run refused to run them:
`maxIterations` was reached, or a `costBudget: { onExceed: 'halt' }` was
crossed.

## Why this is a method and not part of the answer

`run()` resolves to a bare string. There is nowhere in a string to write
"…and three tool calls never ran", which is the same wall 8.6.0 hit with
an outstanding credential consent — and there the turn raises, because
handing back a plausible answer for work a tool never did is a silent
success. This is not that. A limit you configured firing is the limit
working, and the answer is sometimes real (a model can return content AND
tool calls). So it does not raise; it records, in committed state, where
it is provable after the fact — `getLastSnapshot().sharedState.stoppedEarly`
is the same value, and this is the short way to it.

When the answer came back EMPTY the library also warns once on the
console, because an empty string reaching a user is indistinguishable
from a bug.

#### Returns

##### Type Literal

\{ `answerWasEmpty`: `boolean`; `iteration`: `number`; `pendingToolCalls`: `number`; `reason`: `"max-iterations"` \| `"cost-budget"`; \}

###### answerWasEmpty

> `readonly` **answerWasEmpty**: `boolean`

True when the answer handed back is `''` — the loudest form of this.

###### iteration

> `readonly` **iteration**: `number`

The iteration the loop stopped on.

###### pendingToolCalls

> `readonly` **pendingToolCalls**: `number`

How many tool calls the model asked for that will never run.

###### reason

> `readonly` **reason**: `"max-iterations"` \| `"cost-budget"`

***

`undefined`

#### Example

```ts
const answer = await agent.run({ message: 'audit every log file' });
const cut = agent.stoppedEarly();
if (cut) {
  console.log(`stopped at iteration ${cut.iteration}: ${cut.reason}`);
  console.log(`${cut.pendingToolCalls} tool call(s) never ran`);
}
```
