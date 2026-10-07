**Mixed** — opt-in surfaces over a run. "observability" here names a TIER
(opt-in, beside always-on `../core/`), not a role.
Trace: `BoundaryRecorder.ts` (the unified ordered stream), `RunStepRecorder.ts`,
`ToolLineageRecorder.ts`, `RouteRecorder.ts`, `ToolChoiceRecorder.ts`.
`recordRun.ts` can also own the opt-in typed Trust Boundary trace from
`../../lib/trust-boundaries/`; its facts are captured live, never replayed from
the completed event tail. One versioned bundle is added to `snapshot.recorders`.
Fold: `FlowchartRecorder.ts` (`buildStepGraph`, rebuilt per call), `trace.ts`
(`serializeTrace`), `recordingEnvelope.ts`, and `recordRun.ts` — which is the one
KNOWN BREACH of the detachment law: its snapshot half hands out the runner's own
objects by reference (see its header, and `docs/design/map-walker-trace-fold-lens.md`).
Lens (for a human, not the wire): `commentary/`, `status/`, `LoggingRecorder.ts`,
`AgentThinkingTraceRecorder.ts`.
Name to watch: the exported type `Trace` (`trace.ts` · `Trace`) is a redacted
projection — a Fold artifact. The append-only evidence is `BoundaryRecorder.ts`.

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

## Three archive shapes, one relationship

This repo ships THREE producer-owned ways a finished run leaves the process, and
until this section existed their relationship was stated nowhere — which is how
an audit found them drifting toward overlap:

| Shape | For | What it is |
|---|---|---|
| `RecordingEnvelope` (here) | machines | THE versioned contract — the narrow waist. Identity, completeness and drop-count facts stamped as truths or refused. Archives, ingestion, cross-run analysis. |
| `Trace` v1 (`trace.ts`) | humans + UIs | a redacted domain-event PROJECTION of the same run — a presentation, not the contract |
| `exportBugReport` (`src/lib/bug-report/`) | humans filing issues | a zip whose evidence IS an envelope, wrapped in consent machinery (selectable units, redacted-key names, a size ceiling) — a presentation for one workflow |

The rule: the envelope is the contract; the other two are presentations OVER it.

**The fold has happened** (bundle layout 2). `exportBugReport` used to pack a
bare `recording.json` beside an `environment.json` that repeated the producer
facts the envelope stamps. It now builds the envelope through
`buildRecordingEnvelope` — never a second implementation — so `libraryVersion` /
`engineVersion` are stamped once, in `envelope.json`'s `producer`, and
`environment.json` keeps only the host half (Node, platform, architecture).

Two consequences worth knowing:

- **The bug report cannot state every envelope fact, so it refuses in place
  rather than throwing.** `exportBugReport` takes `run: { complete, droppedEvents }`
  and nothing else — a bundle may hold several runs, and one `runId` or
  `startedAt` stated once cannot be true of all of them. When a fact is
  missing, that conversation rides as `recording.json` and the manifest names
  the fact: a reporter still gets a filable bundle, and nothing is stamped that
  was not known.
- **The evidence is never packed twice.** An envelope OR a bare recording, at
  the root or inside a `conversations/<id>.json`, never both — the zip is
  store-only, so a duplicated recording is duplicated bytes against the ceiling
  the trim hints are trying to keep the reporter under.

## A long run's recording: packed (`recordingPack.ts`)

A plain recording repeats the conversation once per place that saw it — each
iteration's slot subflows are seeded with the whole history, the boundary log
keeps each subflow's input and output, `iteration_end` carries the history,
every call re-announces its context — so iteration k writes the k results
before it again and the JSON grows with K²·R. Measured with 1,000-row tool
results: 67 MB at 10 iterations, 808 MB at 40, past JSON's string limit (so
not mintable at all) before 80. `packRecording` writes every repeated value
ONCE and refers to it by index; the same runs pack to 1.3 MB, 5.6 MB and
12.6 MB.

```ts
import { packRecording, recordRun, unpackRecording } from 'agentfootprint/observe';

const recorder = recordRun(agent);
await agent.run({ message });
fs.writeFileSync('run.json', JSON.stringify(packRecording(recorder.toRecording())));

const recording = unpackRecording(JSON.parse(fs.readFileSync('run.json', 'utf8'))); // plain or packed
```

**The law:** `JSON.stringify(unpackRecording(JSON.parse(JSON.stringify(packRecording(r)))))`
is `toWireJson(r)`, byte for byte — packing follows `JSON.stringify` and the
wire rule for Errors, and an object of the recording's own that looks like a
reference is escaped, so no recording can be mistaken for one. `unpackRecording`
reads BOTH shapes (a plain recording comes back untouched) and refuses a packed
format it does not know by name. `openRecording` and the answer-account op read
through it; an Agent mints packed artifacts with `recordings: { packed: true }`
(default off, so the Lens and other readers adopt `unpackRecording` first).
Pinned by `test/recorders/observability/recordingPack.test.ts`, which also
counts the packer's reads: 4× the iterations, ~4× the packed bytes, under 6×
the reads — the residue is the per-iteration context records the in-memory
recording really holds (equal content, new objects), which must be read to be
found equal.

**The expansion bound (the law for every reader):** a packed recording can
stand for far more JSON than it holds — a value referred to ten times by values
each referred to ten times is a few KB packed and 10^k bytes expanded — and a
reader that walks the result as a TREE (a fold, a show-me, a `JSON.stringify`,
a preview) does that much work. So `unpackRecording` expands a packed
recording only when the plain recording it stands for is within `maxBytes`
(UTF-8 bytes of its plain JSON — the size the same recording would have been
minted plain; default `DEFAULT_UNPACK_MAX_BYTES`, 512 MiB, about the largest
plain recording a JavaScript string can hold). The size is measured over the
PACKED form — each pooled value sized once, each packed node read once — and
the refusal (`PackedRecordingTooLargeError`, a `PackedRecordingError`) comes
before anything is built. A plain recording is returned as it is: its bound is
the text it was parsed from, which its reader caps before parsing.

```ts
// A host that explains recordings for others holds a packed one to the SAME
// ceiling as a plain one — the answer-account op does exactly this:
try {
  recording = unpackRecording(JSON.parse(text), { maxBytes: maxRecordingBytes });
} catch (err) {
  if (err instanceof PackedRecordingTooLargeError) throw new RecordingTooLargeForAccountError(maxRecordingBytes);
  throw err;
}
```

Every reader in this package chooses its bound: the answer-account op passes
its `maxRecordingBytes` (a packed payload over it is the same 413 its plain twin
gets); `openRecording` takes the default, because the trace toolpack previews a
value by serializing it (a larger recording you trust:
`openRecording(unpackRecording(packed, { maxBytes }))`). `maxBytes: Infinity`
is only for a reader that trusts the file and never walks it as a tree. Pinned
by the BOUND tests in `test/recorders/observability/recordingPack.test.ts`
(10^40 bytes refused after one read of the packed form, nothing expanded; exact
to the byte) and the packed 413 in `test/hosting/answer-account-op.test.ts`.

A long run also keeps its START: the event tail's cap counts distinct events,
and a re-announced piece of context (`context.injected`, equal field for field
to one still held) is kept without taking a slot (`../../events/eventTail.ts`).
A 100-iteration run used to open at iteration 34.

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
they are raw. Minimize or redact each exported channel before persisting instead.
`recordRun(agent, { boundaryDetail: 'lean' })` removes captured content only
from the **BoundaryEvents bundle**. The ordinary event tail and engine state
can still contain prompts, arguments and results. `serializeTrace`/
`redactContent` operate on their own projection; none of these switches makes
an arbitrary whole recording safe to disclose.

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
