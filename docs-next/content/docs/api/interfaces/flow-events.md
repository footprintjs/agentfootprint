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

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:312

Event passed to FlowRecorder.onBreak.

### Properties

#### propagatedFromSubflow?

> `optional` **propagatedFromSubflow?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:328

When true, this break event was raised on the PARENT because an inner
subflow's break propagated up (via `SubflowMountOptions.propagateBreak`).
The originating inner break fires its own `onBreak` event separately
— this flag lets recorders distinguish the two.

***

#### reason?

> `optional` **reason?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:321

Optional free-form reason supplied by `scope.$break(reason)`. Absent
when the stage invoked `$break()` without an argument. Propagates when
a subflow is mounted with `propagateBreak: true` — the outer break
event carries the inner break's reason too.

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:313

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:314


---


## Interface: FlowDecisionEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:255

Event passed to FlowRecorder.onDecision.

### Properties

#### chosen

> **chosen**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:257

***

#### decider

> **decider**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:256

***

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:259

***

#### evidence?

> `optional` **evidence?**: `DecisionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:262

Structured decision evidence from decide() helper.

***

#### rationale?

> `optional` **rationale?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:258

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:260


---


## Interface: FlowErrorEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:331

Event passed to FlowRecorder.onError.

### Properties

#### channel?

> `optional` **channel?**: `"flow"`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:343

Explicit channel discriminant — `'flow'` on every engine-dispatched
event. `isFlowEvent()` checks it first (backlog B3); optional so
consumer-fabricated events (tests, replays) remain type-valid and fall
back to the legacy pipelineId-absence heuristic.

***

#### message

> **message**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:333

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:332

***

#### structuredError

> **structuredError**: `StructuredErrorInfo`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:335

Structured error details — preserves field-level issues, error codes, etc.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:336


---


## Interface: FlowForkEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:265

Event passed to FlowRecorder.onFork.

### Properties

#### children

> **children**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:267

***

#### parent

> **parent**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:266

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:268


---


## Interface: FlowLoopEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:305

Event passed to FlowRecorder.onLoop.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:308

***

#### iteration

> **iteration**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:307

***

#### target

> **target**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:306

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:309


---


## Interface: FlowNextEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:248

Event passed to FlowRecorder.onNext.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:251

***

#### from

> **from**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:249

***

#### to

> **to**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:250

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:252


---


## Interface: FlowSelectedEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:271

Event passed to FlowRecorder.onSelected.

### Properties

#### evidence?

> `optional` **evidence?**: `SelectionEvidence`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:277

Structured selection evidence from select() helper.

***

#### parent

> **parent**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:272

***

#### selected

> **selected**: `string`[]

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:273

***

#### total

> **total**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:274

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:275


---


## Interface: FlowStageEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:235

Event passed to FlowRecorder.onStageExecuted.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:237

***

#### stageName

> **stageName**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:236

***

#### stageType

> **stageType**: `StageType`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:245

Which kind of stage completed. The engine fires `onStageExecuted`
uniformly for every stage kind (proposal #003); consumers route by
`stageType` without a chart-spec lookup.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:239

Traversal context from the engine — read-only, set by traverser.


---


## Interface: FlowSubflowEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:280

Event passed to FlowRecorder.onSubflow.

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:285

Build-time description of what this subflow does.

***

#### mappedInput?

> `optional` **mappedInput?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:288

Mapped input values sent INTO the subflow (from inputMapper/inputKeys). Present on entry events.

***

#### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:281

***

#### outputState?

> `optional` **outputState?**: `Record`\<`string`, `unknown`\>

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:290

Subflow shared state at exit. Present on exit events.

***

#### subflowId?

> `optional` **subflowId?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:283

Subflow identifier — use this to look up the full spec via the manifest.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:286


---


## Interface: FlowSubflowRegisteredEvent

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:293

Event passed to FlowRecorder.onSubflowRegistered (dynamic subflow attachment).

### Properties

#### description?

> `optional` **description?**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:299

Build-time description.

***

#### name

> **name**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:297

Human-readable name.

***

#### specStructure?

> `optional` **specStructure?**: `unknown`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:301

Full spec structure (when available from buildTimeStructure).

***

#### subflowId

> **subflowId**: `string`

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:295

Subflow identifier.

***

#### traversalContext?

> `optional` **traversalContext?**: [`TraversalContext`](/docs/api/interfaces/TraversalContext)

Defined in: node\_modules/footprintjs/dist/types/lib/engine/narrative/types.d.ts:302
