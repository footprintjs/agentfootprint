---
type: added
---
**AG-UI: any run, as the AG-UI protocol's events — and `toSSE`'s frames became a pluggable strategy.**
A new door, `agentfootprint/ag-ui`, adapts a run's event stream to AG-UI 1.0, the
protocol AG-UI frontends (`@ag-ui/client`, CopilotKit, the AG-UI Dojo) drive agents
with. `agUiSerializer({ threadId, runId })` translates one run's events — text as it
streams, tool calls with their arguments and results, ReAct iterations and
compositions as steps, nested agents (a `Sequence` step, a `Parallel` branch) as
sub-agents with their parent links, a pause as an interrupt, a failure as
`RUN_ERROR` in the record's own words — and `agUiSse()` frames them with the
official `@ag-ui/encoder` (an optional peer, loaded only when a framing is built,
refused by name when missing). It reads only the events every listener receives,
so nothing a redaction policy hides reaches an AG-UI event, at any depth; and since
the stream goes to a browser, nothing else goes out that a person is not meant to
read: `CUSTOM` is an allow-list (`AG_UI_CUSTOM_EVENTS` — progress, spend, the route,
the answer's standing, retries, each with only its listed fields; extend it with a
projection per event type), the model's reasoning is sent only with
`reasoning: true`, and a failure never carries the thrown value. Every id
is the record's own address under the request's run id — unique across a thread
even when parallel branches reuse a provider's tool-call id, and the same with or
without a policy. The SSE framing is now a strategy, `SseFraming`: `toSSE` takes
`framing` and keeps writing exactly the frames it always wrote by default
(`agentfootprintSse`); a protocol adapter implements `RunTranslation` on
`agentfootprint/hosting`.
