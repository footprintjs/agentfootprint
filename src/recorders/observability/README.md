# `src/recorders/observability/` — Tier-3 observability features

## What lives here

The opt-in observability layer. Each file is ONE feature consumers enable in one line via `agent.enable.<feature>(opts)`.

```
recorders/observability/
├── ThinkingRecorder.ts   enable.thinking({ onStatus }) — live status line
├── LoggingRecorder.ts    enable.logging({ domains, logger }) — structured logging
├── BoundaryRecorder.ts   unified domain event log (run / subflow / llm / tool / context)
├── FlowchartRecorder.ts  StepGraph projection for Lens UI
└── LiveStateRecorder.ts  O(1) "is X happening NOW" reads (LLM stream / tool / agent turn)
```

`LiveStateRecorder` is built on the footprintjs `BoundaryStateTracker<TState>` storage primitive (v4.17.2+). Three independently-usable trackers (`LiveLLMTracker`, `LiveToolTracker`, `LiveAgentTurnTracker`) plus a façade. Use the façade when you want all three; use a single tracker when you only need one slice. State is **transient** — clears on stop. For time-travel, snapshot to a `SequenceRecorder`.

Phase 5 additions (planned): `enable.lens`, `enable.tracing`, `enable.cost`, `enable.guardrails`, `enable.eval`.

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
  thinking(opts: ThinkingOptions): Unsubscribe;
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

`agent.enable.thinking({ onStatus: updateStatus })` — consumer provides only the callback. Every other behavior is a sensible default (built-in renderer covers turn / iteration / tool / route / done).

`agent.enable.logging()` — consumer provides nothing. Default logs to console with `domains: ['context', 'stream']` — the debug core.

Defaults matter more than options. The first-line-of-code experience should be: "enable this, it works." Config is for escalation.

### Decision 6: Custom formatters as escape hatch

Every feature accepts an optional `format?: (event) => string | null` callback. Return `null` to skip an event; return a string to override the default rendering. Consumers who need fine-grained control get it without the library exposing a more complex API.

## Features shipped (Phase 3)

### `enable.thinking({ onStatus, format? })`

Claude-Code-style live status line. Fires `onStatus(string)` at each meaningful moment (turn start, iteration start, tool calls, route decision, done). Default renderer produces human-readable strings; override via `format`.

### `enable.logging({ domains?, logger?, format? })`

Structured firehose logging. Filters by domain (default: context + stream). Logger pluggable (default: console). Formatter customizable.

## When to add a new feature

Criteria for a new `enable.<feature>`:

1. The feature is consumer-facing — answers a question a user wants answered.
2. It can be implemented by subscribing to existing typed events (no new core recorders needed).
3. It's stateful in a non-trivial way — if stateless, consumers can just subscribe directly.
4. It has a bounded config surface — 2–5 options max. Bigger = probably needs its own adapter interface.

Pattern: add a factory function in this folder + one method on `EnableNamespace` in `../../core/runner.ts` + one line in `RunnerBase.enable` to wire it.
