# `src/` — agentfootprint

> The grouping layer over footprintjs.

## What lives here

Everything under `src/` composes into one public API: **primitives** (LLMCall, Agent), **compositions** (Sequence/Parallel/Conditional/Loop), **patterns** (Swarm/MapReduce/Debate/Reflection/SelfConsistency/ToT), a **typed event registry** with an **observability layer** consumers opt into in one line, and a self-contained **memory subsystem** (beats / facts / embeddings / pipelines).

```
src/
├── events/             The stable contract: 45+ typed events, the dispatcher.
├── conventions.ts      Builder↔Recorder protocol (subflow IDs, injection keys).
├── adapters/           Ports-and-Adapters outer ring (LLM provider interface + Mock).
├── bridge/             Bridging helpers (footprintjs → agentfootprint event meta).
├── core/               Primitives (LLMCall, Agent) + slot subflow builders + Tool.
├── core-flow/          Compositions (Sequence, Parallel, Conditional, Loop).
├── patterns/           Pattern factories (Swarm, MapReduce, Reflection, Debate, …).
├── memory/             Beats, facts, embeddings, pipelines, stores. Also reachable
│                       via the `agentfootprint/memory` subpath (avoids type
│                       collision between adapter `MemoryStore` and memory store types).
├── recorders/core/     Semantic grouping (raw events → typed events).
├── recorders/observability/   Tier-3 features consumers enable (Flowchart, Logging, Thinking).
└── index.ts            Public barrel. Everything consumers import.
```

## The one-sentence statement

**agentfootprint takes raw footprintjs events and GROUPS them into typed domain events consumers subscribe to.** Two jobs, nothing else:

1. **Builders** mount footprintjs subflows with convention-named IDs (defined in `conventions.ts`).
2. **Recorders** observe those subflows + scope writes → emit grouped events via the typed registry.

Everything downstream (the `.on()` API, the `.enable.*` features, patterns, Lens) consumes the event stream.

## The 7-layer cake (top = consumer-facing)

```
7. Lens / renderers            zero logic; consumes the event stream
6. Patterns                    Swarm · MapReduce · ToT · Reflection · …
5. Primitives                  LLMCall · Agent
4. Compositions                Sequence · Parallel · Conditional · Loop
3. Context Engineering (3-slot) SystemPrompt · Messages · Tools
2. Event Registry              47 typed events + dispatcher
1. footprintjs                 execution engine (unchanged)
```

Dependency flow is one-way, bottom-up. Each layer depends on lower layers only.

## Axioms

These invariants are preserved across every file in `src/`:

- **A1** Every runner exposes `.toFlowChart()` — composition nests freely.
- **A2** The API boundary IS the atom boundary. Consumers never parse subflow paths.
- **A3** Every decision that matters is a typed event. Event stream + topology = fully reconstructable run.
- **A4** Breaking changes OK across major; additive within major. No back-compat shims.
- **A5** Observers are ALWAYS non-blocking. No observer stalls a run.
- **A6** Provider-agnostic — LLM / memory / guardrail / policy portability built in via `adapters/`.
- **A7** Low-cardinality event names; high-cardinality payloads fine.
- **A8** Redaction happens in the dispatcher, before any recorder sees payloads.

## Architecture pattern name

**Event-Driven Hexagonal Architecture with a Typed Event Registry and Pluggable Observability Adapters.**

Components:

- *Hexagonal / Ports-and-Adapters* — `adapters/types.ts` defines the ports; `adapters/<domain>/*` implements them.
- *Event-Driven* — everything observable is a typed event on one central dispatcher.
- *Pipes and Filters* — core recorders transform raw footprintjs events into domain events.
- *Facade* — the `Runner` interface is the single consumer-facing surface.
- *Builder* — every primitive / composition has a `.create()...build()` API.

## What each folder guarantees

| Folder | Guarantee |
|---|---|
| `events/` | The stable public event contract. Additive within a major. |
| `conventions.ts` | The builder↔recorder coordination protocol. One file, one source of truth. |
| `adapters/` | Provider-agnostic interfaces. External dependencies hide behind ports. |
| `bridge/` | Translation helpers between footprintjs and agentfootprint event meta. |
| `core/` | Consumer-facing primitives. Symmetric builder API across all runners. |
| `recorders/core/` | Library-owned grouping — emits the domain events the library promises. |
| `recorders/observability/` | Consumer opt-in features via `.enable.*`. Each one line. |
