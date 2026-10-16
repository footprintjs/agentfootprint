---
title: buildAgentMessageApiChart
---

# Function: buildAgentMessageApiChart()

> **buildAgentMessageApiChart**(`deps`): `FlowChart`

Defined in: [src/core/agent/buildAgentMessageApiChart.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/buildAgentMessageApiChart.ts#L125)

Build the Agent merge-tree chart as one flat ReAct flowchart.

**Cancellation.** Every model call reads its signal from the run's `env`.
For an abort or a deadline to cancel the provider's request, pass the signal
there too: `env: { signal }`, and for a deadline `AbortSignal.timeout(ms)`. A
bare `FlowChartExecutor` hands its own `signal` and `timeoutMs` to the
traversal only. That stops the chart, but a call already in flight runs to
completion, and you are billed for it.

```ts
const controller = new AbortController();
await new FlowChartExecutor(chart).run({
  input: { message: 'hi' },
  signal: controller.signal, // stops the traversal
  env: { signal: controller.signal }, // cancels the model call in flight
});
```

## Parameters

### deps

[`AgentMessageApiChartDeps`](/docs/api/interfaces/AgentMessageApiChartDeps)

## Returns

`FlowChart`
