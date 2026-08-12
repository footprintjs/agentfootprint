[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / flowchartAsTool

# Function: flowchartAsTool()

> **flowchartAsTool**(`opts`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)

Defined in: [src/core/flowchartAsTool.ts:305](https://github.com/footprintjs/agentfootprint/blob/23dde4a00923eb3de0e6e5e6c26dbb8c0014797f/src/core/flowchartAsTool.ts#L305)

Wrap a footprintjs `FlowChart` as a `Tool` the Agent's LLM can call.

On execute:
  1. Constructs a fresh `FlowChartExecutor(flowchart)` per call (so
     consecutive invocations don't share state).
  2. Attaches each `opts.recorders` entry via
     `executor.attachCombinedRecorder` — the SAME recorder instances
     attach to every invocation's fresh executor (see the option's
     JSDoc for the shared-state / runId implications).
  3. Calls `executor.run({ input: args, env: { signal } })` with the
     LLM-supplied args + the agent's abort signal.
  4. If the run paused, throws an Error with the checkpoint attached
     (`error.checkpoint`) so the agent loop can surface it. Polished
     agent-side pause integration is v2.6 work.
  5. If the run completed, calls `resultMapper(snapshot)` (or the
     default JSON.stringify) and returns the string.
  6. If the run threw, the error propagates — the Agent's
     tool-call handler converts it to a synthetic error string for
     the LLM to see + recover from.
  7. With `keepRecord: true`, files the inner record under
     `ctx.toolCallId` on ALL THREE exits (ok / error / paused) —
     "why did it fail?" is the question most likely to come next.

## Parameters

### opts

[`FlowchartAsToolOptions`](/agentfootprint/api/generated/interfaces/FlowchartAsToolOptions.md)

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)
