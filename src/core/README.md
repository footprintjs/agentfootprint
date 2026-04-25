# `src/v2/core/` — primitives + Runner foundation

## What lives here

The consumer-facing primitives (`LLMCall`, `Agent`) and the shared Runner infrastructure they build on.

```
core/
├── runner.ts         Runner interface (extends footprintjs ComposableRunner).
├── RunnerBase.ts     Shared implementation (.on/.off/.once/.attach/.emit/.enable).
├── LLMCall.ts        Primitive: single LLM invocation (no tools, no loop).
├── Agent.ts          Primitive: ReAct loop (LLM + tools + iteration).
├── tools.ts          Tool<TArgs, TResult> contract.
└── slots/            The 3-slot context model (see slots/README.md).
```

## Architectural decisions

### Decision 1: Two primitives, period

`LLMCall` (one-shot) and `Agent` (ReAct) are the only leaves. Every higher-level pattern — Pipeline, Swarm, MapReduce, Reflection, Debate, ToT, Constitutional AI — is a **composition** of these two.

Adding a third primitive would be a sign we're modelling the wrong abstraction. Iteration = Loop composition. Routing = Conditional composition. Parallelism = Parallel composition. Delegation = Swarm pattern over Loop + Conditional.

### Decision 2: The `Runner` interface is the ONE consumer-facing surface

Every primitive, every composition, and every pattern factory returns an object implementing `Runner<TIn, TOut>`. That means any runner composes into any other runner. No special types per pattern.

`Runner` extends footprintjs's `ComposableRunner` (adds `.toFlowChart()` + `.run()`) and layers on:

- `.on() / .off() / .once()` — typed event subscription
- `.attach(recorder)` — custom CombinedRecorder attachment
- `.emit(name, payload)` — consumer custom events
- `.enable.*` — Tier-3 observability features

### Decision 3: `RunnerBase` shares the wiring; subclasses supply structure

Primitives + compositions extend `RunnerBase`. The base handles the dispatcher, recorder array, subscription API, and `.enable.*` namespace. Subclasses override `toFlowChart()` (what subflows to mount) and `run()` (how to interpret the executor result).

Keeping the shared code in ONE base class means subscription semantics can't drift between primitives.

### Decision 4: Symmetric builder API

Every primitive / composition has the same shape:

```typescript
Foo.create(opts).<member>(…).<member>(…).build() → Foo
```

Consumers learn the pattern once and apply it everywhere. Today: `LLMCall.create(...).system(...).build()`, `Agent.create(...).system(...).tool(...).build()`. Later: `Sequence.create(...).step(...).step(...).build()`, etc.

### Decision 5: Return values use `return`, not side-channels

Stages in a primitive's internal FlowChart `return` their result. footprintjs's executor carries that as the `TraversalResult`. Consumers call `.run()` and get the string back.

We do NOT write to shared scope + read from `getSnapshot()`. Return is cleaner, makes the runner compositionally pure (the OUTPUT of one is the INPUT of the next in a Sequence), and matches how every function-composition mental model works.

`$break()` is reserved for abnormal termination (max iterations reached, budget exhausted, user-requested cancel). Success uses `return`.

### Decision 6: Each runner owns its own dispatcher

Every time `.run()` is called, a fresh footprintjs executor starts. Internal core recorders (ContextRecorder, StreamRecorder, AgentRecorder) attach to that executor and route events into the runner's dispatcher. Consumer listeners are attached once to the runner and persist across multiple `.run()` calls.

That means you can build an agent once, attach listeners once, and call `.run()` many times — the subscription state persists, the execution state doesn't.

### Decision 7: Primitives and compositions are siblings, not parents

`Agent` does NOT extend `LLMCall`. They're two separate leaves with different internal structures (Agent has a loop + routing; LLMCall doesn't). They share logic only through the slot subflow builders in `slots/`.

This keeps them independently evolvable. When Phase 5 adds skills to Agent, LLMCall doesn't need changes.

## What a primitive provides

Minimum contract:
- A builder with `.create()...build()`
- Implementation of `toFlowChart()` — the footprintjs FlowChart it mounts
- Implementation of `run(input, options?)` — executes the chart + surfaces the result
- Emits all applicable `agent.*` / `stream.*` events from its internal stages (via `typedEmit()`)
- Attaches `ContextRecorder` + `StreamRecorder` + `AgentRecorder` internally so core domain events flow

## When to add a new primitive (rare)

Before adding one, verify the behavior can't be expressed as a composition of LLMCall + Agent + existing compositions. If it truly can't, the new primitive must:
- Implement `Runner<TIn, TOut>`
- Attach the three core recorders (Context / Stream / Agent) internally
- Document its internal subflow structure + events it emits
