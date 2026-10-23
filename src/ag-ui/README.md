**Lens** — one run served to an AG-UI reader: the record's events, translated
into the AG-UI protocol's events and framed for the wire.

## What it reads / what it writes
- Reads ONE run's typed events as the record serves them — what every
  listener receives, the placeholder wherever a redaction policy selected a
  value — and how the run settled (`hosting/protocolAdapter.ts` ·
  `RunSettlement`).
- Writes AG-UI 1.0 events (`types.ts`): `serializer.ts` builds them,
  `framing.ts` frames them with the official `@ag-ui/encoder`, an optional peer
  loaded only when a framing is built.
- Never reads the run's live values (`core/runnerLive.ts`), its state or its
  snapshot. Nothing a policy hides can reach an AG-UI event, at any depth.

## The one law here
Every value in an AG-UI event comes from a served event, from the record's
address (`runtimeStageId`, `subflowPath` — never selected by a policy), or from
the AG-UI request's own ids. The record's own `runId` is never written (it
counts every run the process made); a failed tool call's result is the fixed
words unless the app chose `toolErrors: 'served'`; a tool's progress `payload`
goes out only when the app lists it. Every id is minted
by `ids.ts` from that address under the request's `runId`: injective, unique
across a thread, and the same with or without a policy.

## How a run maps
- An agent turn mounted inside a composition is an AG-UI sub-agent: its
  `turn_start` opens a scope at its subflow path, and every event under that
  path carries the scope's `subagentRunId` — parallel branches have different
  paths, so their interleaved events are never attributed to each other.
- `agent.iteration_*` and `composition.enter/exit` are steps; the step's
  address rides `metadata.agentfootprint` (AG-UI 1.0 has no parent field on a
  step).
- Text is the streamed reply (`stream.token`); an agent's answer that streamed
  nothing is written whole from `turn_end`; an agent's `llm_end.content` is a
  draft and is never written.
- A paused run ends with `RUN_FINISHED { outcome: interrupt }` (the question's
  text — from whichever home its kind keeps it in — nothing else of the pause's
  payload); a run paused on a tool the client runs (`awaiting: 'caller'`) ends
  with `RUN_FINISHED { outcome: success, pendingToolCallIds }`; a failed one with
  `RUN_ERROR` in fixed words — the served `error.fatal` only when it is one of
  the library's fixed sentences (`LLM_ERROR_SENTENCES`), else "The run failed."
  An answer an enforcing `.answerValidation()` withheld is a refusal, not a
  crash: `RUN_ERROR { code: 'ERR_ANSWER_VALIDATION' }` with its own fixed
  sentence (`AG_UI_ANSWER_WITHHELD`) — the host names the refusal by the
  error's class (`RunSettlement.refusal`). The settlement never hands an
  adapter the thrown value.
- A continuation is the SAME invocation: the paused translation's `suspension()`
  (ids and step names only — every scope's open calls among them, so parallel
  branches that paused together are each answered in turn) passed as `resume` re-opens the suspended sub-agents
  under their own ids and their steps, and the first result in the paused call's
  scope answers that call under its own id (a client-run tool's result is never
  written back). `RUN_STARTED` waits until the run names itself.
- `CUSTOM` is an ALLOW-LIST (`AG_UI_CUSTOM_EVENTS`): progress, spend, the route,
  the answer's standing, retries — each with only the fields its projection
  picks. The rest of the record (the assembled prompt, a raw retry error, memory,
  permission and credential facts) stays off the wire unless an app lists it.
- Reasoning goes out only with `reasoning: true`.
- Pinned by `test/ag-ui/redaction.property.test.ts`: a policy's marked values never
  reach the framed wire, at any depth, even with every event allow-listed.

## A request is untrusted browser input
`request.ts` reads a `RunAgentInput` (shape, and the thread/run ids' format and
length — refused by the field's NAME, never by echoing its value) and plans the
ONE turn it may ask for, against what the server holds: only the newest user
message is conversation (the page's assistant/tool messages are its own copy and
are never read; a system/developer message is refused); an answer is taken only
for the pause the server keeps, matched to the ids its suspension handed out; a
frontend tool only by the app's name allow-list, with the APP's contract
(`frontendTools.ts` — a tool that pauses for the page, no server privilege);
`state`/`context` only through the app's validators. Identity, credentials and
redaction never come from a request: `hosting/streamHandler.ts` binds the thread
to the caller the app authenticates and builds a fresh runner per request.
Pinned by `test/ag-ui/request.test.ts`, `host.scenario.test.ts` (the official
client) and `tenants.test.ts` (two users at once).

## Three strategies around one core
`agUi()` composes a READER (a body → an `AgUiTurnRequest`; default: the body is
a `RunAgentInput`), a TRANSLATION (default `agUiSerializer`) and a FRAMING
(default `agUiSse`). Each is replaceable on its own — a gateway that sends its
own body and expects its own envelope replaces the reader and the framing.
The CORE is not a strategy: `readAgUiRequest` (an async reader is refused as the
app's mistake) copies what a custom reader
returned as plain JSON (each value read once — a getter cannot answer the check
one way and the plan another; the default reader's body is parsed JSON and is
read as it is) and runs `readAgUiRunInput` on it, then `planAgUiTurn` — the
same checks for every reader. A reader's own `WireRequestRefusal` keeps its
status; anything else it throws is the fixed `ERR_INVALID_RUN_INPUT`. A framing
keeps no per-stream state: the host hands it each frame's number in its stream
(`SseFramePosition`). The default composition's wire is pinned byte for byte
by `test/ag-ui/gateway.test.ts` against a capture taken before the split
(`fixtures/default-wire.golden.json`).

```ts
type GatewayBody = { conversationId: string; requestId: string; text: string };
agUi({
  reader: ({ body }) => {
    const b = body as GatewayBody; // untrusted: the core checks what this returns
    return { threadId: b.conversationId, runId: b.requestId,
      messages: [{ id: 'm', role: 'user', content: b.text }] };
  },
  framing: { contentType: 'text/event-stream',
    frame: (event, { sequence }) => `data: ${JSON.stringify({ event: { ...event, eventSequence: sequence } })}\n\n` },
});
```

## Files
- `types.ts` — the AG-UI events written here and the request read here,
  structural (no `@ag-ui/*` import).
- `ids.ts` — the one id grammar.
- `serializer.ts` — `agUiSerializer`, the per-run translation.
- `framing.ts` — `agUiSse`, the framing strategy.
- `request.ts` — the reader port (`AgUiRequestReader`), the core's read
  (`readAgUiRequest` → `readAgUiRunInput`) and the turn a request may ask for.
- `frontendTools.ts` — the app's allow-listed frontend tools, as tools that pause
  for the page.
- `adapter.ts` — `agUi()`, the `ProtocolAdapter` the host takes: the three
  strategies, composed.
