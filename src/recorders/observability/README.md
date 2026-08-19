# `src/recorders/observability/` — Tier-3 observability features

## What lives here

The opt-in observability layer. Each file is ONE feature consumers enable in one line via `agent.enable.<feature>(opts)`.

```
recorders/observability/
├── StatusRecorder.ts   live-status helper (attachStatus) behind enable.liveStatus
├── LoggingRecorder.ts    structured-logging helper (attachLogging) behind enable.observability
├── BoundaryRecorder.ts   unified domain event log (run / subflow / llm / tool / context)
├── FlowchartRecorder.ts  StepGraph projection for Lens UI
└── LiveStateRecorder.ts  O(1) "is X happening NOW" reads (LLM stream / tool / agent turn)
```

`LiveStateRecorder` is built on the footprintjs `BoundaryStateStore<TState>` storage primitive (v4.17.2+). Three independently-usable trackers (`LiveLLMTracker`, `LiveToolTracker`, `LiveAgentTurnTracker`) plus a façade. Use the façade when you want all three; use a single tracker when you only need one slice. State is **transient** — clears on stop. For time-travel, snapshot to a `SequenceStore`.

Phase 5 additions (planned): `enable.lens`, `enable.tracing`, `enable.cost`, `enable.guardrails`, `enable.eval`.

## Saving a run: `recordRun` → `RecordingEnvelope` → a sink

Three files, three jobs, in the order you meet them:

```
recordRun.ts             collect a run into { events, snapshot, structure }
recordingEnvelope.ts     wrap that in a versioned, archivable contract
fileRecordingSink.ts     put one envelope somewhere (the reference sink)
```

`recordRun` is enough to hand a run to a viewer in the same process. It is not
enough to put one on disk: it carries no format marker, no producer version, no
statement of *which* run it is, and no statement of whether it is the *whole*
run. Before the envelope, every consumer that wanted to archive a recording,
attach it to a bug report, or feed it to an analysis tool invented its own
wrapper — and each one guessed differently about the same missing facts.

```ts
import { recordRun, persistRecording, fileRecordingSink } from 'agentfootprint/observe';

const recorder = recordRun(agent);
await agent.run({ message: 'Weather in San Francisco?' });

const { uri } = await persistRecording(recorder, {
  sink: fileRecordingSink({ directory: './run-archive' }),
  run: { complete: true },
});
recorder.stop();
// → ./run-archive/run-1787093273110-1.json
```

### The rule: never stamp a fact you had to guess

An archive is read by people and tools that were not there when the run
happened, so every field is a claim. Each one has a stated source, and where a
fact is neither derivable nor supplied the builder **refuses** rather than
filling in something plausible:

| field | where it comes from |
|---|---|
| `runId`, `sessionId`, `principal`, `tenant` | the **event meta**, or the caller. Never synthesized. |
| `startedAt` / `endedAt` | event wall clocks — but only where the stream can honestly supply them |
| `complete` | **caller input, always.** Nothing in a frozen recording says whether it reached the run's end |
| `droppedEvents` | the live `recordRun` handle, which counts them |
| `configuration` | the run's own `run_configured` manifest (names and ids only, by law) |
| `producer` | the package manifests, at runtime |

Three consequences worth knowing before they surprise you:

- **Identity is inherited, not derived.** `principal` and `tenant` come from
  `EventMeta`, whose own law is that they are stamped only from an explicit
  `run(input, { identity })` — never from a session id, because a conversation
  id is not an actor. An anonymous run produces an envelope with **no
  `principal` key at all**.
- **A bare `Recording` cannot report `droppedEvents`.** Only the live handle
  counts what the `maxEvents` cap discarded. Pass the handle, or state the
  count — `0` here has to mean "none were dropped", not "we did not look".
- **An incomplete recording gets no `endedAt`.** A run that had not finished
  has no end time, so absence is the honest answer.

### Privacy: v1 is `'full'` only, and says so

`persistRecording(..., { privacy: { mode: 'redacted' } })` **throws**. The label
is what downstream readers act on — an archive browser decides what to show, a
retention rule decides how long to keep it — so stamping `redacted` on
un-redacted bytes would get them handled with *less* care than bytes that admit
they are raw. Redact before persisting instead: `recordRun(agent, {
boundaryDetail: 'lean' })` captures no payloads at all, and
`serializeTrace`/`redactContent` redact at the serialize boundary.

### Writing your own sink

A sink is one method — `write(envelope) => Promise<{ id, uri? }>` — so a table,
a bucket or an HTTP endpoint is a few lines. Read `fileRecordingSink.ts` first
for the two things that are easy to get wrong: the write is **atomic** (tmp file
then rename, so a crash never leaves a half-parsed archive that looks like
evidence), and the file name is a **key**, so the run id is asserted against a
safe, case-unambiguous charset and refused by name otherwise.

## Why a separate layer

Core recorders (in `../core/`) are ALWAYS attached by every runner — they ARE the library's event-emission machinery. Observability recorders are **consumer-attached**, fire zero cost when not enabled, and focus on DERIVED signals (readable status lines, structured logs, OTEL spans, cost totals, etc.).

Keeping them in a separate folder makes the split obvious:

| Core (`../core/`) | Observability (this folder) |
|---|---|
| Always attached | Opt-in via `.enable.*` |
| Emits typed events | Consumes typed events |
| Library-owned shape | Consumer-configured output |
| Cost: minor, fast-path gated | Cost: zero when disabled |

## Architectural decisions

### Decision 1: Attach to the dispatcher, NOT footprintjs's emit channel

Observability recorders subscribe to the `EventDispatcher` (via `dispatcher.on('*', ...)`). They see the **unified event stream** — every domain, including `context.*` events which never flow through footprintjs's emit channel (they come from scope-write observation in `ContextRecorder`).

If an observability recorder were to attach as a footprintjs `CombinedRecorder`, it would miss `context.*` entirely. The dispatcher is the single fan-in point.

### Decision 2: Each feature is a factory function, not a class

```typescript
// The pattern every observability feature follows:
export function attach<Feature>(
  dispatcher: EventDispatcher,
  options: <Feature>Options,
): Unsubscribe {
  return dispatcher.on('*', (event) => { /* handle */ });
}
```

Factory returns an `Unsubscribe` function. Consumer calls the unsubscribe to disable. No class state to manage; no lifecycle beyond the subscription.

### Decision 3: Enabled via `Runner.enable.<feature>(opts)`

The `Runner` interface exposes an `enable` namespace. Each feature has a single method. The method calls the factory, returns the `Unsubscribe`.

```typescript
// Runner.enable namespace — types declared in src/core/runner.ts
interface EnableNamespace {
  thinking(opts: StatusOptions): Unsubscribe;
  logging(opts?: LoggingOptions): Unsubscribe;
  // Phase 5:
  // lens(opts): Unsubscribe;
  // tracing(opts): Unsubscribe;
  // cost(opts): Unsubscribe;
  // guardrails(opts): Unsubscribe;
}
```

The namespace groups features discoverable via IDE autocomplete — `agent.enable.` gives consumers the full catalog without memorizing names.

### Decision 4: Consumer-friendly domain names, NOT internal tiers

Early drafts exposed `level: 'tier1' | 'tier2' | 'tier3'` for log filtering. Removed — "tier1" is our internal classification, not vocabulary consumers should learn.

Replaced with **domain names** that match the event namespace consumers already see: `domains: [LoggingDomains.CONTEXT, LoggingDomains.STREAM]`. Self-documenting; zero new concepts.

### Decision 5: Sensible defaults — "the most useful thing without config"

`agent.enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine }) })` — consumer provides only the callback inside the strategy. Every other behavior is a sensible default (built-in renderer covers turn / iteration / tool / route / done).

`agent.enable.observability({ strategy: consoleObservability() })` — the console strategy logs every event with zero further config.

Defaults matter more than options. The first-line-of-code experience should be: "enable this, it works." Config is for escalation.

### Decision 6: Custom formatters as escape hatch

Every feature accepts an optional `format?: (event) => string | null` callback. Return `null` to skip an event; return a string to override the default rendering. Consumers who need fine-grained control get it without the library exposing a more complex API.

## Features shipped (Phase 3)

### `enable.liveStatus({ strategy })` (e.g. `chatBubbleLiveStatus({ onLine, format? })`)

Claude-Code-style live status line. Fires `onLine(string)` at each meaningful moment (turn start, iteration start, tool calls, route decision, done). Default renderer produces human-readable strings; override via `format`. The low-level `attachStatus(dispatcher, …)` helper (this folder) backs it.

### `enable.observability({ strategy })` (e.g. `consoleObservability({ logger?, format? })`)

Structured firehose logging. Logger pluggable (default: console). Formatter customizable. The low-level `attachLogging(dispatcher, …)` helper (this folder) backs the console case.

## When to add a new feature

Criteria for a new `enable.<feature>`:

1. The feature is consumer-facing — answers a question a user wants answered.
2. It can be implemented by subscribing to existing typed events (no new core recorders needed).
3. It's stateful in a non-trivial way — if stateless, consumers can just subscribe directly.
4. It has a bounded config surface — 2–5 options max. Bigger = probably needs its own adapter interface.

Pattern: add a factory function in this folder + one method on `EnableNamespace` in `../../core/runner.ts` + one line in `RunnerBase.enable` to wire it.
