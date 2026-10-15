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
address (`runtimeStageId`, `subflowPath`, agentfootprint's `runId` — never
selected by a policy), or from the AG-UI request's own ids. Every id is minted
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
  text, nothing else of the pause's payload); a failed one with `RUN_ERROR`, in
  the words of the record's served `error.fatal` — the settlement never hands an
  adapter the thrown value.
- `CUSTOM` is an ALLOW-LIST (`AG_UI_CUSTOM_EVENTS`): progress, spend, the route,
  the answer's standing, retries — each with only the fields its projection
  picks. The rest of the record (the assembled prompt, a raw retry error, memory,
  permission and credential facts) stays off the wire unless an app lists it.
- Reasoning goes out only with `reasoning: true`.
- Pinned by `test/ag-ui/redaction.property.test.ts`: a policy's marked values never
  reach the framed wire, at any depth, even with every event allow-listed.

## Files
- `types.ts` — the AG-UI events written here, structural (no `@ag-ui/*` import).
- `ids.ts` — the one id grammar.
- `serializer.ts` — `agUiSerializer`, the per-run translation.
- `framing.ts` — `agUiSse`, the framing strategy.
