---
title: FlowchartAsToolOptions
---

# Interface: FlowchartAsToolOptions

Defined in: [src/core/flowchartAsTool.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L182)

Options for `flowchartAsTool`.

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/core/flowchartAsTool.ts:186](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L186)

Tool description shown to the LLM.

***

### flowchart

> `readonly` **flowchart**: `FlowChart`

Defined in: [src/core/flowchartAsTool.ts:196](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L196)

The footprintjs flowchart to mount as the tool's body.
The chart's stages receive args via `scope.$getArgs()`.

***

### inputSchema?

> `readonly` `optional` **inputSchema?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/flowchartAsTool.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L191)

JSON Schema describing the input args the LLM must produce.
Becomes `flowchart.run({ input: args })`. Default: `{ type: 'object', properties: {} }`.

***

### keepRecord?

> `readonly` `optional` **keepRecord?**: `boolean`

Defined in: [src/core/flowchartAsTool.ts:259](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L259)

KEEP the inner run's record, so the agent's trace can go THROUGH this
tool boundary instead of stopping at it.

Off by default, and the default is the honest one: a retained record
is a retained snapshot, and a tool called every turn would pin one per
call forever. Turning it on is the caller agreeing to that memory.

With it on, each invocation's record is filed under the `toolCallId`
the outer run already uses to name the call — so `inspect_tool_call`
gains a line teaching the descent, and `inspect_tool_run` opens the
inner chart with the same drill vocabulary (overview → step → value →
why). Records are bounded: the last [keepRecordLimit](/docs/api/interfaces/FlowchartAsToolOptions#keeprecordlimit)
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

Defined in: [src/core/flowchartAsTool.ts:266](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L266)

How many invocations `keepRecord` retains. Default
DEFAULT\_INNER\_RUN\_LIMIT (20) — a debugging window, not an
archive. Only meaningful with `keepRecord: true`; passing it alone is
refused rather than silently ignored.

***

### name

> `readonly` **name**: `string`

Defined in: [src/core/flowchartAsTool.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L184)

Tool name the LLM dispatches by. Must be unique across the agent's tools.

***

### recorders?

> `readonly` `optional` **recorders?**: readonly [`CombinedRecorder`](/docs/api/type-aliases/CombinedRecorder)[]

Defined in: [src/core/flowchartAsTool.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L227)

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

> `readonly` `optional` **redact?**: [`RedactionPolicy`](/docs/api/interfaces/RedactionPolicy)

Defined in: [src/core/flowchartAsTool.ts:330](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L330)

Redaction policy for the INNER run, applied before every invocation
(`executor.setRedactionPolicy`).

footprintjs scrubs at COMMIT time, so a redacted key never reaches the
inner COMMIT LOG at all — through every path, since footprintjs 9.19.0
(see 3 below). Same mechanism, same placeholders, and the same
`(redacted by policy)` flag as the outer run; the trace tools pass
placeholders through verbatim and never reconstruct around them.

ONE RULE FOR EVERYTHING THE TOOL SHOWS (9.89.1). With a policy set, every
state-bearing thing this tool hands outward is footprintjs's REDACTED
view — `getSnapshot({ redact: true })`, the mirror the engine maintains
beside the raw heap for exactly this — taken through one owner,
`servableSnapshot`:

- the string this tool RETURNS: `resultMapper` is handed `snapshot.values`
  from that view (`'REDACTED'` where the log says so), so the default
  `JSON.stringify` and a custom mapper see the same thing the log holds;
- a kept record's `sharedState`, `commitLog` and every subflow's final
  state (`subflowResults[*].treeContext.globalContext` — the subflow's
  own redacted mirror, served by footprintjs itself since 9.20.0);
- on every exit — ok, error, paused — the record is filed from that view.

Independent of `keepRecord` — a chart handling secrets should carry a
policy whether or not anyone keeps its record. Without this option the
raw snapshot is served, byte for byte as before.

WHAT IT DOES NOT GOVERN — said here so nobody has to rediscover it:

1. The run's fold base. The redacted view OMITS `initialState`
   (footprintjs `ExecutionRuntime.getSnapshot`: the raw pre-run seed
   never passed a policy, so it is dropped rather than served). A fold of
   a kept record therefore reports `basis: 'log-only'` — partial, and
   saying so. A subflow's `treeContext.initialState` travels as
   footprintjs serves it: its seed is a commit of its own (`history[0]`),
   so that base is the nested runtime's pre-seed state.
2. The resume checkpoint. A paused run throws with `err.checkpoint`,
   which holds real values because resumption must replay against them;
   it goes to the agent loop, never to a model.
3. What the LOG itself carries — footprintjs's law, not this option's,
   and since footprintjs 9.19.0 (this package's floor from 9.89.2) that
   law is one rule: a policy covers everything the run retains or serves
   — the log in both encodings, the mirror, `stageReads`/`stageWrites`,
   the narrative, a subflow's `inputMapper` seed (its `history[0]` and
   its `Input:` line), its `outputMapper` merge-back, `fields` dot-paths
   — and never the live heap or the checkpoint. The five places 9.18
   left plaintext in the record (dot-path fields, merge-back, seed, seed
   narrative, tracked reads) are closed at the root, and each is asserted
   closed in `test/core/flowchartAsTool.redact.test.ts` §6 (red on 9.18).
   So "every field" means every field, and the log agrees. The last
   limit — `subflowResults[*].treeContext.globalContext` and its `#n`
   twin were the subflow's own heap, since only the run-level runtime
   kept a mirror, which `servableSnapshot` refolded from the scrubbed
   `history` — is closed by footprintjs 9.20.0 (this package's floor
   from 9.89.3): a subflow keeps its own mirror whenever the run does,
   and the redacted view serves it, one object under both keys. Nothing
   left the log carries that the served view does not scrub; the
   checkpoint is not a served view. `servableSnapshot` is now that view
   exactly as the substrate serves it, and §7 of the same file pins both
   the placeholder in footprintjs's own view (red on 9.19.x) and the
   identity.

***

### resultMapper?

> `readonly` `optional` **resultMapper?**: [`FlowchartResultMapper`](/docs/api/type-aliases/FlowchartResultMapper)

Defined in: [src/core/flowchartAsTool.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L201)

Optional shaping function. Default: `JSON.stringify(snapshot.values)`.
Errors throw into the tool's `[mapper-error: ...]` envelope.
