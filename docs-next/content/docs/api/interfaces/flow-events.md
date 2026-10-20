---
title: Flow event payloads
description: Related recorder payloads, with a section for each interface.
---


## Interface: StageEvent

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:68

### Extends

- `RecorderContext`

### Properties

#### correlation?

> `readonly` `optional` **correlation?**: `RunCorrelation`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:22

The run's correlation (10.1) — the same frozen object as `TraversalContext.correlation` on the flow events
and `getSnapshot().correlation`. Absent — no key — when the run's env gave none.

##### Inherited from

`RecorderContext.correlation`

***

#### duration?

> `optional` **duration?**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:69

***

#### pipelineId

> **pipelineId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:16

##### Inherited from

`RecorderContext.pipelineId`

***

#### runtimeStageId

> **runtimeStageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:15

Unique per-execution-step identifier. Format: [subflowPath/]stageId#executionIndex

##### Inherited from

`RecorderContext.runtimeStageId`

***

#### stageId

> **stageId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:13

Stable stage identifier (matches spec node id).

##### Inherited from

`RecorderContext.stageId`

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:11

##### Inherited from

`RecorderContext.stageName`

***

#### timestamp

> **timestamp**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/scope/types.d.ts:17

##### Inherited from

`RecorderContext.timestamp`


---


## Interface: FlowBreakEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:309

Event passed to FlowRecorder.onBreak.

### Properties

#### propagatedFromSubflow?

> `optional` **propagatedFromSubflow?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:325

When true, this break event was raised on the PARENT because an inner
subflow's break propagated up (via `SubflowMountOptions.propagateBreak`).
The originating inner break fires its own `onBreak` event separately
— this flag lets recorders distinguish the two.

***

#### reason?

> `optional` **reason?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:318

Optional free-form reason supplied by `scope.$break(reason)`. Absent
when the stage invoked `$break()` without an argument. Propagates when
a subflow is mounted with `propagateBreak: true` — the outer break
event carries the inner break's reason too.

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:310

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:311


---


## Interface: FlowDecisionEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:252

Event passed to FlowRecorder.onDecision.

### Properties

#### chosen

> **chosen**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:254

***

#### decider

> **decider**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:253

***

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:256

***

#### evidence?

> `optional` **evidence?**: `DecisionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:259

Structured decision evidence from decide() helper.

***

#### rationale?

> `optional` **rationale?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:255

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:257


---


## Interface: FlowErrorEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:328

Event passed to FlowRecorder.onError.

### Properties

#### channel?

> `optional` **channel?**: `"flow"`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:340

Explicit channel discriminant — `'flow'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-absence heuristic.

***

#### message

> **message**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:330

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:329

***

#### structuredError

> **structuredError**: `StructuredErrorInfo`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:332

Structured error details — preserves field-level issues, error codes, etc.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:333


---


## Interface: FlowForkEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:262

Event passed to FlowRecorder.onFork.

### Properties

#### children

> **children**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:264

***

#### parent

> **parent**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:263

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:265


---


## Interface: FlowLoopEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:302

Event passed to FlowRecorder.onLoop.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:305

***

#### iteration

> **iteration**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:304

***

#### target

> **target**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:303

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:306


---


## Interface: FlowNextEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:245

Event passed to FlowRecorder.onNext.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:248

***

#### from

> **from**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:246

***

#### to

> **to**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:247

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:249


---


## Interface: FlowSelectedEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:268

Event passed to FlowRecorder.onSelected.

### Properties

#### evidence?

> `optional` **evidence?**: `SelectionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:274

Structured selection evidence from select() helper.

***

#### parent

> **parent**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:269

***

#### selected

> **selected**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:270

***

#### total

> **total**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:271

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:272


---


## Interface: FlowStageEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:232

Event passed to FlowRecorder.onStageExecuted.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:234

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:233

***

#### stageType

> **stageType**: `StageType`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:242

Which kind of stage completed. The engine fires `onStageExecuted`
uniformly for every stage kind (proposal #003); consumers route by
`stageType` without a chart-spec lookup.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:236

Traversal context from the engine — read-only, set by traverser.


---


## Interface: FlowSubflowEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:277

Event passed to FlowRecorder.onSubflow.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:282

Build-time description of what this subflow does.

***

#### mappedInput?

> `optional` **mappedInput?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:285

Mapped input values sent INTO the subflow (from inputMapper/inputKeys). Present on entry events.

***

#### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:278

***

#### outputState?

> `optional` **outputState?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:287

Subflow shared state at exit. Present on exit events.

***

#### subflowId?

> `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:280

Subflow identifier — use this to look up the full spec via the manifest.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:283


---


## Interface: FlowSubflowRegisteredEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:290

Event passed to FlowRecorder.onSubflowRegistered (dynamic subflow attachment).

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:296

Build-time description.

***

#### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:294

Human-readable name.

***

#### specStructure?

> `optional` **specStructure?**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:298

Full spec structure (when available from buildTimeStructure).

***

#### subflowId

> **subflowId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:292

Subflow identifier.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:299
