---
title: FlowchartAsToolOptions
---

# Interface: FlowchartAsToolOptions

Defined in: [src/core/flowchartAsTool.ts:134](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L134)

Options for `flowchartAsTool`.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/core/flowchartAsTool.ts:138](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L138)

Tool description shown to the LLM.

***

### flowchart

> `readonly` **flowchart**: `FlowChart`

Defined in: [src/core/flowchartAsTool.ts:148](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L148)

The footprintjs flowchart to mount as the tool's body.
The chart's stages receive args via `scope.$getArgs()`.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:143](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L143)

JSON Schema describing the input args the LLM must produce.
Becomes `flowchart.run({ input: args })`. Default: `{ type: 'object', properties: {} }`.

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/flowchartAsTool.ts:136](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L136)

Tool name the LLM dispatches by. Must be unique across the agent's tools.

***

### recorders?

> `readonly` `optional` **recorders?**: readonly [`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)[]

Defined in: [src/core/flowchartAsTool.ts:179](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L179)

Observers to attach to the tool's INTERNAL `FlowChartExecutor`
before each run. This is the hook that lets decide()/select()
evidence (and every other footprintjs event) inside a tool-mounted
flowchart reach agent-layer evidence consumers — e.g. the causal
`causalEvidenceRecorder()` bridge or `otel.decisionEvidenceRecorder()`.
Without it, the internal executor is unobservable from outside.

Each entry is a footprintjs `CombinedRecorder`, attached via
`executor.attachCombinedRecorder` and routed by runtime
method-shape detection — so ONE array covers all three observer
channels (scope data-flow `onRead`/`onWrite`/`onCommit`/…,
control-flow `onDecision`/`onSelected`/`onLoop`/…, and emit
`onEmit`). Implement only the hooks you care about.

**Per-invocation semantics:** the tool builds a FRESH executor per
call (flowchart state never leaks between invocations) and attaches
every recorder in this array to EACH invocation's executor before
`run()`. The recorder INSTANCES are yours and are shared across
invocations — a stateful recorder therefore accumulates events from
EVERY invocation of the tool. Each invocation is a distinct run
with a fresh `runId`; recorders needing per-invocation bookkeeping
detect the boundary via `event.traversalContext.runId !== lastRunId`
(Convention 4) rather than assuming one run per recorder lifetime.

***

### resultMapper?

> `readonly` `optional` **resultMapper?**: [`FlowchartResultMapper`](/docs/api/type-aliases/FlowchartResultMapper)

Defined in: [src/core/flowchartAsTool.ts:153](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/flowchartAsTool.ts#L153)

Optional shaping function. Default: `JSON.stringify(snapshot.values)`.
Errors throw into the tool's `[mapper-error: ...]` envelope.
