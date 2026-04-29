[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StepNode

# Interface: StepNode

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:57](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L57)

One node in the step-level flowchart. Node kind drives rendering
(actor icon, color). ReAct steps carry token + tool details; topology
nodes (subflow / fork-branch / decision-branch) mirror the footprintjs
composition events and exist so composition structure (Loop, Parallel,
Conditional, Swarm) stays visible in the graph.

## Properties

### endOffsetMs?

> `readonly` `optional` **endOffsetMs?**: `number`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:69](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L69)

***

### entryPayload?

> `readonly` `optional` **entryPayload?**: `unknown`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:97](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L97)

`inputMapper` payload at the subflow's entry. Subflow nodes only.

***

### exitPayload?

> `readonly` `optional` **exitPayload?**: `unknown`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:100](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L100)

Subflow shared state at exit. Subflow nodes only.
 Undefined for in-progress / paused subflows.

***

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:58](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L58)

***

### injections?

> `readonly` `optional` **injections?**: readonly [`ContextInjection`](/agentfootprint/api/generated/interfaces/ContextInjection.md)[]

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:79](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L79)

Context injections attributed to this step (LLM steps only).

***

### isAgentBoundary?

> `readonly` `optional` **isAgentBoundary?**: `boolean`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:88](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L88)

True ONLY for `subflow` StepNodes whose primitiveKind is `'Agent'`.
 Narrow flag for callers that distinguish ReAct agents from other
 composition primitives (cost / iteration / token attribution).

***

### isPrimitiveBoundary?

> `readonly` `optional` **isPrimitiveBoundary?**: `boolean`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:95](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L95)

True for `subflow` StepNodes representing any KNOWN primitive
 (Agent / LLMCall / Sequence / Parallel / Conditional / Loop) —
 drives Lens's drill-in container treatment.

***

### iterationIndex?

> `readonly` `optional` **iterationIndex?**: `number`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:82](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L82)

1-based ReAct iteration this step belongs to. Undefined for
 topology / composition nodes.

***

### kind

> `readonly` **kind**: `"fork-branch"` \| `"decision-branch"` \| `"user->llm"` \| `"llm->tool"` \| `"tool->llm"` \| `"llm->user"` \| `"subflow"`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:59](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L59)

***

### label

> `readonly` **label**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:67](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L67)

***

### llmModel?

> `readonly` `optional` **llmModel?**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:75](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L75)

user->llm / tool->llm: the model that was invoked.

***

### primitiveKind?

> `readonly` `optional` **primitiveKind?**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:91](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L91)

Primitive kind from the subflow root description prefix
 (`'Agent'` / `'LLMCall'` / `'Sequence'` / etc.).

***

### runtimeStageId?

> `readonly` `optional` **runtimeStageId?**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:102](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L102)

Stable per-execution key — same `runtimeStageId` Trace view uses.

***

### slotBoundaries?

> `readonly` `optional` **slotBoundaries?**: `object`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:121](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L121)

Slot boundary payloads composed for THIS LLM step.

Set ONLY for `kind === 'user->llm'` and `kind === 'tool->llm'`
StepNodes — the moments where context flows INTO the LLM. Each
entry carries the slot subflow's `inputMapper` result (entryPayload)
and rendered slot output (exitPayload).

Attribution: any slot subflow that fired BETWEEN the previous LLM
end (or run start) and THIS LLM start is attributed to this call.
Done at projection time over `boundary.getEvents()`; no consumer-
side correlation required.

Lens uses this to make the 3 slot rows inside the LLM card
clickable — clicking a slot reveals its entry/exit payloads in
the right-pane detail panel without needing direct BoundaryRecorder
access.

#### messages?

> `readonly` `optional` **messages?**: `SlotBoundary`

#### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `SlotBoundary`

#### tools?

> `readonly` `optional` **tools?**: `SlotBoundary`

***

### slotUpdated?

> `readonly` `optional` **slotUpdated?**: `"system-prompt"` \| `"messages"` \| `"tools"`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:84](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L84)

Which slot the step's input updated. ReAct steps only.

***

### startOffsetMs

> `readonly` **startOffsetMs**: `number`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:68](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L68)

***

### subflowPath

> `readonly` **subflowPath**: readonly `string`[]

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:77](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L77)

Decomposition of the underlying subflowId (rooted under '__root__').

***

### tokens?

> `readonly` `optional` **tokens?**: `object`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L71)

LLM step: token usage of the call that bounded this step.

#### in

> `readonly` **in**: `number`

#### out

> `readonly` **out**: `number`

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:73](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L73)

llm->tool / tool->llm: the tool name.
