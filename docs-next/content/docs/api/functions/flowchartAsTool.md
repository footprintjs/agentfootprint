---
title: flowchartAsTool
---

# Function: flowchartAsTool()

> **flowchartAsTool**(`opts`): [`Tool`](/docs/api/interfaces/Tool)

Defined in: [src/core/flowchartAsTool.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/flowchartAsTool.ts#L203)

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

## Parameters

### opts

[`FlowchartAsToolOptions`](/docs/api/interfaces/FlowchartAsToolOptions)

## Returns

[`Tool`](/docs/api/interfaces/Tool)
