---
type: added
---
**AG-UI: any run, as the AG-UI protocol's events — and `toSSE`'s frames became a pluggable strategy.**
A new door, `agentfootprint/ag-ui`, adapts a run's event stream to AG-UI 1.0, the
protocol AG-UI frontends (`@ag-ui/client`, CopilotKit, the AG-UI Dojo) drive agents
with. `agUiSerializer({ threadId, runId })` translates one run's events — text as it
streams, tool calls with their arguments and results, ReAct iterations and
compositions as steps, nested agents (a `Sequence` step, a `Parallel` branch) as
sub-agents with their parent links, a pause as an interrupt (or, for a tool the
client runs, a completed segment with the call pending), a failure as `RUN_ERROR`
in the record's own words — and `agUiSse()` frames them with the
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
without a policy. A paused run's translation hands back `suspension()`, and the
run that continues it passes it as `resume`: its sub-agents re-open under their own
`subagentRunId`, its open steps re-open, and the call it stopped in is answered under
its own id — one invocation across both requests. `owns` binds a translation to its
run when one listener hears several. The SSE framing is now a strategy, `SseFraming`: `toSSE` takes
`framing` and keeps writing exactly the frames it always wrote by default
(`agentfootprintSse`); a protocol adapter implements `RunTranslation` on
`agentfootprint/hosting`.

**Also fixed — a pause two levels deep is addressed like every other event.**
`pause.request` and `pause.resume` carried footprintjs's resume cursor as their
`meta.subflowPath` — one cumulative mount id per level (`['step-p', 'step-p/x']`)
where every other event carries the segments (`['step-p', 'x']`). They now carry the
segments, so a reader finds the agent that paused the way it finds the owner of any
event. Unchanged at the root and at depth one, where the two forms agree.
