[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / flowchartAsTool

# Function: flowchartAsTool()

> **flowchartAsTool**(`opts`): [`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)

Defined in: [src/core/flowchartAsTool.ts:163](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/core/flowchartAsTool.ts#L163)

Wrap a footprintjs `FlowChart` as a `Tool` the Agent's LLM can call.

On execute:
  1. Constructs a fresh `FlowChartExecutor(flowchart)` per call (so
     consecutive invocations don't share state).
  2. Calls `executor.run({ input: args, env: { signal } })` with the
     LLM-supplied args + the agent's abort signal.
  3. If the run paused, throws an Error with the checkpoint attached
     (`error.checkpoint`) so the agent loop can surface it. Polished
     agent-side pause integration is v2.6 work.
  4. If the run completed, calls `resultMapper(snapshot)` (or the
     default JSON.stringify) and returns the string.
  5. If the run threw, the error propagates — the Agent's
     tool-call handler converts it to a synthetic error string for
     the LLM to see + recover from.

## Parameters

### opts

[`FlowchartAsToolOptions`](/agentfootprint/api/generated/interfaces/FlowchartAsToolOptions.md)

## Returns

[`Tool`](/agentfootprint/api/generated/interfaces/Tool.md)
