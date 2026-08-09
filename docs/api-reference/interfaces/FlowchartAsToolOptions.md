[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartAsToolOptions

# Interface: FlowchartAsToolOptions

Defined in: [src/core/flowchartAsTool.ts:174](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L174)

Options for `flowchartAsTool`.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/core/flowchartAsTool.ts:178](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L178)

Tool description shown to the LLM.

***

### flowchart

> `readonly` **flowchart**: `FlowChart`

Defined in: [src/core/flowchartAsTool.ts:188](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L188)

The footprintjs flowchart to mount as the tool's body.
The chart's stages receive args via `scope.$getArgs()`.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:183](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L183)

JSON Schema describing the input args the LLM must produce.
Becomes `flowchart.run({ input: args })`. Default: `{ type: 'object', properties: {} }`.

***

### keepRecord?

> `readonly` `optional` **keepRecord?**: `boolean`

Defined in: [src/core/flowchartAsTool.ts:251](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L251)

KEEP the inner run's record, so the agent's trace can go THROUGH this
tool boundary instead of stopping at it.

Off by default, and the default is the honest one: a retained record
is a retained snapshot, and a tool called every turn would pin one per
call forever. Turning it on is the caller agreeing to that memory.

With it on, each invocation's record is filed under the `toolCallId`
the outer run already uses to name the call — so `inspect_tool_call`
gains a line teaching the descent, and `inspect_tool_run` opens the
inner chart with the same drill vocabulary (overview → step → value →
why). Records are bounded: the last [keepRecordLimit](/agentfootprint/api/generated/interfaces/FlowchartAsToolOptions.md#keeprecordlimit)
invocations, least-recently-used dropped first, and a session that
dropped some says so rather than answering "not found".

What it costs when ON: one `controlDepRecorder()` attached per
invocation (so inner slices carry the `[control: rule]` edges a
serialized recording can never carry back), and the invocation's
snapshot held by reference until it ages out.

What it costs when OFF: nothing. No store, no extra recorder, no
capture — the byte-identical path this tool had before the option
existed.

**One store per `flowchartAsTool(...)` call**, held on the returned
tool — the same scoping as the `recorders` array above. Mount that one
tool object on two agents and they share it, which is usually what you
want (the id is the agent's own tool-call id) but is worth knowing if
the two agents can mint the same id: build the tool twice instead.

***

### keepRecordLimit?

> `readonly` `optional` **keepRecordLimit?**: `number`

Defined in: [src/core/flowchartAsTool.ts:258](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L258)

How many invocations `keepRecord` retains. Default
DEFAULT\_INNER\_RUN\_LIMIT (20) — a debugging window, not an
archive. Only meaningful with `keepRecord: true`; passing it alone is
refused rather than silently ignored.

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/flowchartAsTool.ts:176](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L176)

Tool name the LLM dispatches by. Must be unique across the agent's tools.

***

### recorders?

> `readonly` `optional` **recorders?**: readonly [`CombinedRecorder`](/agentfootprint/api/generated/type-aliases/CombinedRecorder.md)[]

Defined in: [src/core/flowchartAsTool.ts:219](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L219)

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

### redact?

> `readonly` `optional` **redact?**: [`RedactionPolicy`](/agentfootprint/api/generated/interfaces/RedactionPolicy.md)

Defined in: [src/core/flowchartAsTool.ts:278](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L278)

Redaction policy for the INNER run, applied before every invocation
(`executor.setRedactionPolicy`).

footprintjs scrubs at COMMIT time, so a redacted key never reaches the
inner commit log at all — which is what makes a kept record safe to
serve back to a model. Same mechanism, same placeholders, and the same
`(redacted by policy)` flag as the outer run; the trace tools pass
placeholders through verbatim and never reconstruct around them.

Independent of `keepRecord` — a chart handling secrets should carry a
policy whether or not anyone keeps its record — but if you keep the
record, this is the switch that decides what the record contains.

What it does NOT govern: the string this tool RETURNS. `resultMapper`
is handed `snapshot.values`, which is the run's live state — the same
unredacted view a stage read. Scrubbing what the LLM sees is the
mapper's job; this option scrubs what the RECORD keeps.

***

### resultMapper?

> `readonly` `optional` **resultMapper?**: [`FlowchartResultMapper`](/agentfootprint/api/generated/type-aliases/FlowchartResultMapper.md)

Defined in: [src/core/flowchartAsTool.ts:193](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/core/flowchartAsTool.ts#L193)

Optional shaping function. Default: `JSON.stringify(snapshot.values)`.
Errors throw into the tool's `[mapper-error: ...]` envelope.
