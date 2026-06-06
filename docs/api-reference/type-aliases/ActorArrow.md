[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ActorArrow

# Type Alias: ActorArrow

> **ActorArrow** = `"user→llm"` \| `"tool→llm"` \| `"llm→tool"` \| `"llm→user"`

Defined in: [src/recorders/observability/BoundaryRecorder.ts:247](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L247)

The 4 actor arrows of a ReAct cycle. Tagged on `llm.start` / `llm.end`
at capture time so consumers (slider, run-flow renderer) dispatch by
`event.actorArrow` instead of running their own state machine.

  - `'user→llm'` — first LLM call, or any LLM call NOT preceded by a
    tool result (assembled-context delivery to the model).
  - `'tool→llm'` — LLM call that follows a tool's result (the next
    iteration of a ReAct loop).
  - `'llm→tool'` — `llm.end` whose `toolCallCount > 0` (the LLM is
    requesting tool execution).
  - `'llm→user'` — `llm.end` with `toolCallCount === 0` (terminal
    response delivered to the user).
